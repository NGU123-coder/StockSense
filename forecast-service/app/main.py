"""
StockSense forecasting service (FastAPI).

Called by the Node API (service-to-service, authenticated with X-Internal-Key).
Reads sales history and stock positions from PostgreSQL, fits one model per
product/warehouse in parallel worker processes, and returns forecasts plus
reorder recommendations. Interactive docs: http://localhost:8000/docs
"""

from __future__ import annotations

import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Query

from . import db
from .config import get_settings
from .forecasting import build_daily_series, forecast_demand, inventory_policy, prediction_band
from .schemas import ForecastResult, RunRequest, RunResponse, RunStats, SeriesPoint

IST = ZoneInfo("Asia/Kolkata")

app = FastAPI(
    title="StockSense Forecasting Service",
    version="1.0.0",
    description="Demand forecasting (Holt-Winters) and inventory policy (safety stock, reorder point, order quantity).",
)


def require_internal_key(x_internal_key: Annotated[str | None, Header()] = None) -> None:
    if x_internal_key != get_settings().internal_api_key:
        raise HTTPException(status_code=401, detail="Invalid internal API key")


def _today() -> date:
    return datetime.now(IST).date()


def _forecast_one(args: tuple) -> dict:
    """Runs in a worker process: model fit + policy for one product/warehouse pair."""
    pair, sales_rows, start, end, req = args
    sales = pd.DataFrame(sales_rows, columns=["day", "qty"])
    series = build_daily_series(sales, start, end)
    fc = forecast_demand(series, horizon=req["horizon_days"])
    policy = inventory_policy(
        fc,
        on_hand=int(pair["on_hand"]),
        on_order=int(pair["on_order"]),
        lead_time_days=int(pair["lead_time_days"]),
        service_level=req["service_level"],
        cover_days=req["cover_days"],
        today=end + timedelta(days=1),
    )
    lower, upper = prediction_band(fc.values, fc.sigma)
    first_day = end + timedelta(days=1)
    return {
        "product_id": pair["product_id"],
        "warehouse_id": pair["warehouse_id"],
        "model": fc.model,
        "lead_time_days": int(pair["lead_time_days"]),
        "on_hand": int(pair["on_hand"]),
        "on_order": int(pair["on_order"]),
        "mape": round(fc.wape, 4) if fc.wape is not None else None,
        "mae": round(fc.mae, 3) if fc.mae is not None else None,
        **{k: getattr(policy, k) for k in policy.__dataclass_fields__},
        "series": [
            {
                "date": first_day + timedelta(days=i),
                "qty": round(float(v), 2),
                "lower": round(float(lo), 2),
                "upper": round(float(hi), 2),
            }
            for i, (v, lo, hi) in enumerate(zip(fc.values, lower, upper, strict=True))
        ],
    }


def run_forecasts(req: RunRequest) -> list[dict]:
    today = _today()
    end = today - timedelta(days=1)  # only complete days; today's partial sales would bias the model
    start = today - timedelta(days=req.history_days)

    pairs = db.load_pairs(req.product_ids, req.warehouse_ids)
    if pairs.empty:
        return []
    sales = db.load_sales(start, today, req.product_ids, req.warehouse_ids)
    grouped = {k: g[["day", "qty"]].values.tolist() for k, g in sales.groupby(["product_id", "warehouse_id"])}

    req_dict = req.model_dump()
    jobs = [
        (row, grouped.get((row["product_id"], row["warehouse_id"]), []), start, end, req_dict)
        for row in pairs.to_dict("records")
    ]
    workers = max(1, get_settings().workers)
    if workers == 1 or len(jobs) < 8:
        return [_forecast_one(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_forecast_one, jobs, chunksize=8))


@app.get("/health", tags=["ops"])
def health() -> dict:
    try:
        db.ping()
        database = "up"
    except Exception:  # noqa: BLE001
        database = "down"
    return {"status": "ok" if database == "up" else "degraded", "database": database}


@app.post(
    "/forecast/run",
    response_model=RunResponse,
    dependencies=[Depends(require_internal_key)],
    tags=["forecast"],
    summary="Forecast demand and compute reorder policy for every product/warehouse",
)
def forecast_run(req: RunRequest) -> RunResponse:
    started = time.perf_counter()
    results = run_forecasts(req)
    return RunResponse(
        generated_at=datetime.now(UTC),
        results=[ForecastResult(**r) for r in results],
        stats=RunStats(
            series_count=len(results),
            duration_ms=int((time.perf_counter() - started) * 1000),
            models=dict(Counter(r["model"] for r in results)),
        ),
    )


@app.get(
    "/forecast/preview",
    response_model=ForecastResult,
    dependencies=[Depends(require_internal_key)],
    tags=["forecast"],
    summary="Forecast a single product in a single warehouse (handy for exploring in /docs)",
)
def forecast_preview(
    product_id: str,
    warehouse_id: str,
    horizon_days: Annotated[int, Query(ge=7, le=120)] = 30,
    service_level: Annotated[float, Query(gt=0.5, lt=0.999)] = 0.95,
) -> ForecastResult:
    req = RunRequest(
        horizon_days=horizon_days,
        service_level=service_level,
        product_ids=[product_id],
        warehouse_ids=[warehouse_id],
    )
    results = run_forecasts(req)
    if not results:
        raise HTTPException(status_code=404, detail="No stock record for that product and warehouse")
    r = results[0]
    r["series"] = [SeriesPoint(**p) for p in r["series"]]
    return ForecastResult(**r)
