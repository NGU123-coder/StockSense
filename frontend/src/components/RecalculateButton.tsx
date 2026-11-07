import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useForecastStatus } from '../api/queries';
import { useAuth } from '../hooks/useAuth';
import { timeAgo } from '../lib/format';

/** Triggers a forecast run (queued in BullMQ). The result arrives over the websocket. */
export function RecalculateButton() {
  const { allowed } = useAuth();
  const qc = useQueryClient();
  const status = useForecastStatus();
  const run = useMutation({
    mutationFn: () => api.post<{ queued: boolean }>('/forecasts/run'),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['forecast-status'] });
      if (r.queued) toast.info('Recalculating forecasts', { description: 'This takes about 10 seconds.' });
      else qc.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const running = run.isPending || status.data?.running;

  return (
    <div className="flex items-center gap-3">
      {status.data?.lastRunAt && (
        <span className="hidden text-[12px] text-muted sm:inline">Forecast updated {timeAgo(status.data.lastRunAt)}</span>
      )}
      {allowed('runForecast') && (
        <button className="btn-ghost" onClick={() => run.mutate()} disabled={running || status.data?.serviceHealthy === false}
          title={status.data?.serviceHealthy === false ? 'The forecasting service is offline' : undefined}>
          <RefreshCw size={15} className={running ? 'animate-spin' : undefined} />
          {running ? 'Recalculating…' : 'Recalculate forecasts'}
        </button>
      )}
    </div>
  );
}
