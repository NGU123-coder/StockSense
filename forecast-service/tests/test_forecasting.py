from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.forecasting import (
    Forecast,
    build_daily_series,
    days_until_stockout,
    forecast_demand,
    inventory_policy,
    prediction_band,
    wape,
    z_score,
)


def weekly_series(days=180, base=50.0, seed=7):
    """Synthetic demand: weekends 30% higher, Poisson noise."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2026-01-01", periods=days, freq="D")
    mean = np.array([base * (1.3 if d.day_of_week >= 5 else 1.0) for d in idx])
    return pd.Series(rng.poisson(mean).astype(float), index=idx)


def flat_forecast(daily=10.0, sigma=3.0, horizon=30):
    return Forecast(model="test", values=np.full(horizon, daily), sigma=sigma, wape=None, mae=None)


def test_build_daily_series_fills_missing_days_with_zero():
    sales = pd.DataFrame({"day": [date(2026, 1, 1), date(2026, 1, 3)], "qty": [5, 7]})
    s = build_daily_series(sales, date(2026, 1, 1), date(2026, 1, 4))
    assert s.tolist() == [5, 0, 7, 0]


def test_holt_winters_learns_level_and_weekly_pattern():
    fc = forecast_demand(weekly_series(), horizon=14)
    assert fc.model == "holt_winters"
    assert len(fc.values) == 14
    assert 45 < fc.values.mean() < 60
    # Weekend days (index 2,3 → Sat/Sun after a series ending on a Thursday) forecast higher
    assert fc.values.max() > fc.values.min() * 1.15
    assert fc.wape is not None and fc.wape < 0.25


def test_short_history_falls_back_to_moving_average():
    fc = forecast_demand(weekly_series(days=30), horizon=7)
    assert fc.model == "moving_average"
    assert np.all(fc.values >= 0)


def test_forecast_is_never_negative_for_declining_demand():
    idx = pd.date_range("2026-01-01", periods=120, freq="D")
    s = pd.Series(np.linspace(40, 1, 120).round(), index=idx)
    fc = forecast_demand(s, horizon=60)
    assert np.all(fc.values >= 0)


def test_z_score_matches_standard_table():
    assert z_score(0.95) == pytest.approx(1.645, abs=1e-3)
    assert z_score(0.99) == pytest.approx(2.326, abs=1e-3)


def test_wape_handles_zero_actuals():
    assert wape(np.array([0, 0]), np.array([1, 1])) is None
    assert wape(np.array([10, 10]), np.array([8, 12])) == pytest.approx(0.2)


def test_reorder_point_is_lead_time_demand_plus_safety_stock():
    # 10/day, sigma 3, lead time 4 days, 95% → SS = 1.645 * 3 * 2 = 9.87 → 10; ROP = 40 + 9.87 → 50
    p = inventory_policy(flat_forecast(), on_hand=100, on_order=0, lead_time_days=4, today=date(2026, 1, 1))
    assert p.safety_stock == 10
    assert p.reorder_point == 50
    assert p.recommended_order_qty == 0  # 100 on hand is above the reorder point


def test_orders_when_inventory_position_hits_reorder_point():
    p = inventory_policy(flat_forecast(), on_hand=30, on_order=0, lead_time_days=4, cover_days=14)
    # target = demand over 18 days (180) + SS (9.87) → 189.87; minus 30 on hand → 160
    assert p.recommended_order_qty == 160


def test_stock_already_on_order_prevents_double_ordering():
    p = inventory_policy(flat_forecast(), on_hand=30, on_order=200, lead_time_days=4)
    assert p.recommended_order_qty == 0


def test_days_until_stockout_walks_the_forecast():
    assert days_until_stockout(25, np.array([10, 10, 10, 10])) == pytest.approx(2.5)
    assert days_until_stockout(0, np.array([10.0])) == 0
    assert days_until_stockout(100, np.array([0.0, 0.0])) is None


def test_overstock_detected_beyond_sixty_days_of_demand():
    p = inventory_policy(
        flat_forecast(daily=5, sigma=1), on_hand=1000, on_order=0, lead_time_days=7, today=date(2026, 1, 1)
    )
    # max sensible stock ≈ SS (4.35) + 5 * 60 = 304 → excess ≈ 695
    assert 690 <= p.excess_qty <= 700
    assert p.stockout_date == date(2026, 1, 1) + timedelta(days=200)


def test_prediction_band_contains_forecast_and_widens():
    values = np.full(30, 20.0)
    lower, upper = prediction_band(values, sigma=4)
    assert np.all(lower <= values) and np.all(upper >= values)
    assert (upper[-1] - lower[-1]) > (upper[0] - lower[0])
