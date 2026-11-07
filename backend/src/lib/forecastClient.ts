import { env } from '../config/env';
import { HttpError } from '../utils/httpError';

/** Shape returned by the FastAPI forecasting service (snake_case, Python side). */
export interface ForecastResult {
  product_id: string;
  warehouse_id: string;
  model: string;
  avg_daily_demand: number;
  demand_std_dev: number;
  lead_time_days: number;
  safety_stock: number;
  reorder_point: number;
  recommended_order_qty: number;
  on_hand: number;
  on_order: number;
  days_of_cover: number | null;
  stockout_date: string | null;
  excess_qty: number;
  mape: number | null;
  mae: number | null;
  series: { date: string; qty: number; lower: number; upper: number }[];
}

export interface ForecastRunResponse {
  generated_at: string;
  results: ForecastResult[];
  stats: { series_count: number; duration_ms: number };
}

/** Service-to-service call. Authenticated with a shared internal API key, not a user JWT. */
export async function callForecastService(body: Record<string, unknown>): Promise<ForecastRunResponse> {
  let res: Response;
  try {
    res = await fetch(`${env.FORECAST_SERVICE_URL}/forecast/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': env.INTERNAL_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new HttpError(503, 'Forecasting service is not reachable');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, `Forecasting service error (${res.status})`, text.slice(0, 500));
  }
  return (await res.json()) as ForecastRunResponse;
}

export async function forecastServiceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${env.FORECAST_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
