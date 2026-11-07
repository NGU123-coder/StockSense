"""
Demand forecasting and inventory policy — pure functions, no database or web code,
so every formula here is unit-tested in isolation.

Pipeline for one product in one warehouse
-----------------------------------------
1. Daily sales series (missing days = 0 sales).
2. Forecast the next `horizon` days with Holt-Winters exponential smoothing
   (damped additive trend + weekly seasonality). Short or sparse histories fall
   back to a weekday-adjusted moving average.
3. Backtest on the last 28 days to measure accuracy (WAPE and MAE).
4. Turn the forecast into an inventory policy:

       safety stock  = z * sigma_daily * sqrt(lead_time)
       reorder point = expected demand during lead time + safety stock
       order qty     = (demand over lead time + review cover) + safety stock − (on hand + on order)

   where z comes from the target service level (95% → 1.645) and sigma_daily is
   the standard deviation of the model's daily errors.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy.stats import norm

FIT_WINDOW_DAYS = 120  # recent history the model learns from (captures current level + trend)
BACKTEST_DAYS = 28
MIN_DAYS_FOR_HOLT_WINTERS = 56  # 8 full weeks so weekly seasonality can be estimated
OVERSTOCK_DAYS = 60  # stock beyond safety stock + 60 days of demand counts as excess


@dataclass
class Forecast:
    model: str
    values: np.ndarray  # daily point forecast for the horizon
    sigma: float  # std-dev of daily forecast errors
    wape: float | None  # weighted absolute percentage error on the backtest (0.12 = 12%)
    mae: float | None


@dataclass
class Policy:
    avg_daily_demand: float
    demand_std_dev: float
    safety_stock: int
    reorder_point: int
    recommended_order_qty: int
    days_of_cover: float | None
    stockout_date: date | None
    excess_qty: int


def build_daily_series(sales: pd.DataFrame, start: date, end: date) -> pd.Series:
    """sales has columns [day, qty]; returns a continuous daily series from start to end (inclusive)."""
    idx = pd.date_range(start, end, freq="D")
    if sales.empty:
        return pd.Series(0.0, index=idx)
    s = sales.assign(day=pd.to_datetime(sales["day"])).groupby("day")["qty"].sum()
    return s.reindex(idx, fill_value=0).astype(float)


def _moving_average_forecast(history: pd.Series, horizon: int, start: pd.Timestamp) -> np.ndarray:
    """Average of the last 28 days, scaled by each weekday's share of demand."""
    recent = history.iloc[-28:] if len(history) >= 7 else history
    base = float(recent.mean()) if len(recent) else 0.0
    if base <= 0 or len(recent) < 14:
        return np.full(horizon, max(base, 0.0))
    by_dow = recent.groupby(recent.index.day_of_week).mean()
    factors = (by_dow / base).reindex(range(7), fill_value=1.0)
    days = pd.date_range(start, periods=horizon, freq="D")
    return np.array([base * factors[d.day_of_week] for d in days])


def _holt_winters(history: pd.Series, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """Returns (forecast, in-sample residuals)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # convergence chatter on flat series
        model = ExponentialSmoothing(
            history.to_numpy(),
            trend="add",
            damped_trend=True,
            seasonal="add",
            seasonal_periods=7,
            initialization_method="estimated",
        ).fit(optimized=True)
    return np.asarray(model.forecast(horizon)), np.asarray(model.resid)


def _can_use_holt_winters(history: pd.Series) -> bool:
    nonzero_share = float((history > 0).mean()) if len(history) else 0.0
    return len(history) >= MIN_DAYS_FOR_HOLT_WINTERS and nonzero_share >= 0.5


def _predict(history: pd.Series, horizon: int) -> tuple[str, np.ndarray, np.ndarray]:
    start = history.index[-1] + pd.Timedelta(days=1)
    if _can_use_holt_winters(history):
        try:
            values, resid = _holt_winters(history, horizon)
            if np.all(np.isfinite(values)):
                return "holt_winters", np.clip(values, 0, None), resid
        except Exception:  # noqa: BLE001 — any numerical failure falls back to a simpler model
            pass
    values = _moving_average_forecast(history, horizon, start)
    fitted = history.rolling(28, min_periods=1).mean().shift(1).bfill()
    return "moving_average", values, (history - fitted).to_numpy()


def wape(actual: np.ndarray, predicted: np.ndarray) -> float | None:
    """Weighted absolute percentage error: sum|error| / sum(actual). Robust to zero-sale days."""
    total = float(np.sum(actual))
    if total <= 0:
        return None
    return float(np.sum(np.abs(actual - predicted)) / total)


def forecast_demand(series: pd.Series, horizon: int = 30) -> Forecast:
    """Fits on the recent window, backtests on the last 28 days, then forecasts `horizon` days ahead."""
    history = series.iloc[-FIT_WINDOW_DAYS:]

    wape_value = mae_value = None
    if len(history) >= MIN_DAYS_FOR_HOLT_WINTERS + BACKTEST_DAYS // 2:
        train, test = history.iloc[:-BACKTEST_DAYS], history.iloc[-BACKTEST_DAYS:]
        _, backtest_pred, _ = _predict(train, BACKTEST_DAYS)
        wape_value = wape(test.to_numpy(), backtest_pred)
        mae_value = float(np.mean(np.abs(test.to_numpy() - backtest_pred)))

    model, values, resid = _predict(history, horizon)
    resid = resid[np.isfinite(resid)]
    sigma = float(np.std(resid[-60:], ddof=1)) if len(resid) > 2 else float(np.sqrt(max(values.mean(), 0)))
    return Forecast(model=model, values=values, sigma=sigma, wape=wape_value, mae=mae_value)


def z_score(service_level: float) -> float:
    """Service level → standard normal z. 0.95 → 1.645 (stock out in only 5% of cycles)."""
    return float(norm.ppf(service_level))


def days_until_stockout(on_hand: float, daily: np.ndarray) -> float | None:
    """Walks the forecast day by day until cumulative demand exceeds stock on hand."""
    if on_hand <= 0:
        return 0.0
    cumulative = np.cumsum(daily)
    idx = int(np.searchsorted(cumulative, on_hand, side="right"))
    if idx < len(daily):
        prev = cumulative[idx - 1] if idx > 0 else 0.0
        fraction = (on_hand - prev) / daily[idx] if daily[idx] > 0 else 0.0
        return round(idx + fraction, 1)
    avg = float(np.mean(daily)) if len(daily) else 0.0
    return round(on_hand / avg, 1) if avg > 0 else None


def inventory_policy(
    forecast: Forecast,
    on_hand: int,
    on_order: int,
    lead_time_days: int,
    service_level: float = 0.95,
    cover_days: int = 14,
    today: date | None = None,
) -> Policy:
    today = today or date.today()
    f = forecast.values
    avg = float(np.mean(f[:30])) if len(f) else 0.0

    def demand_over(days: int) -> float:
        """Expected demand over the next `days`, extending past the horizon with the average."""
        if days <= len(f):
            return float(np.sum(f[:days]))
        return float(np.sum(f)) + (days - len(f)) * avg

    lead_demand = demand_over(lead_time_days)
    safety = z_score(service_level) * forecast.sigma * math.sqrt(lead_time_days)
    reorder_point = math.ceil(lead_demand + safety)

    position = on_hand + on_order
    recommended = 0
    if position <= reorder_point and avg > 0:
        target = demand_over(lead_time_days + cover_days) + safety
        recommended = max(0, math.ceil(target - position))

    cover = days_until_stockout(on_hand, f)
    stockout = today + timedelta(days=math.floor(cover)) if cover is not None and cover < 365 else None
    excess = max(0, math.floor(on_hand - (safety + avg * OVERSTOCK_DAYS))) if avg > 0 else on_hand

    return Policy(
        avg_daily_demand=round(avg, 2),
        demand_std_dev=round(forecast.sigma, 2),
        safety_stock=math.ceil(safety),
        reorder_point=reorder_point,
        recommended_order_qty=recommended,
        days_of_cover=cover,
        stockout_date=stockout,
        excess_qty=excess,
    )


def prediction_band(values: np.ndarray, sigma: float, confidence: float = 0.8) -> tuple[np.ndarray, np.ndarray]:
    """Interval around each daily forecast that widens gently with distance into the future."""
    z = norm.ppf(0.5 + confidence / 2)
    widen = np.sqrt(1 + np.arange(len(values)) / 30)
    half = z * sigma * widen
    return np.clip(values - half, 0, None), values + half
