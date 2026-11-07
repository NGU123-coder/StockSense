from datetime import date, datetime

from pydantic import BaseModel, Field


class RunRequest(BaseModel):
    horizon_days: int = Field(30, ge=7, le=120, description="How many days ahead to forecast")
    service_level: float = Field(0.95, gt=0.5, lt=0.999, description="Target probability of not running out")
    cover_days: int = Field(14, ge=1, le=90, description="Extra days of demand each order should cover")
    history_days: int = Field(365, ge=28, le=1095)
    product_ids: list[str] | None = None
    warehouse_ids: list[str] | None = None


class SeriesPoint(BaseModel):
    date: date
    qty: float
    lower: float
    upper: float


class ForecastResult(BaseModel):
    product_id: str
    warehouse_id: str
    model: str
    avg_daily_demand: float
    demand_std_dev: float
    lead_time_days: int
    safety_stock: int
    reorder_point: int
    recommended_order_qty: int
    on_hand: int
    on_order: int
    days_of_cover: float | None
    stockout_date: date | None
    excess_qty: int
    mape: float | None = Field(None, description="Backtest WAPE on the last 28 days (0.12 = 12%)")
    mae: float | None
    series: list[SeriesPoint]


class RunStats(BaseModel):
    series_count: int
    duration_ms: int
    models: dict[str, int]


class RunResponse(BaseModel):
    generated_at: datetime
    results: list[ForecastResult]
    stats: RunStats
