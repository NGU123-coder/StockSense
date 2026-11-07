import clsx from 'clsx';

/**
 * The stock runway: the app's signature visual.
 * One bar shows stock on hand against the safety stock (hatched zone) and the
 * reorder point (amber tick). A manager reads urgency without reading numbers.
 */
export function Runway({
  quantity,
  reorderPoint,
  safetyStock = 0,
  size = 'sm',
  showLabels = false,
}: {
  quantity: number;
  reorderPoint: number;
  safetyStock?: number;
  size?: 'sm' | 'md';
  showLabels?: boolean;
}) {
  // Scale so the reorder point sits around 40% of the track, unless stock is far above it.
  const max = Math.max(quantity * 1.08, reorderPoint * 2.5, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const tone = quantity === 0 ? 'out' : quantity <= reorderPoint ? 'low' : 'ok';

  return (
    <div className={clsx('w-full', showLabels && 'pb-5')}>
      <div
        className={clsx('relative w-full overflow-visible rounded-full bg-concrete', size === 'sm' ? 'h-2' : 'h-3.5')}
        role="img"
        aria-label={`${quantity} on hand, reorder point ${reorderPoint}`}
      >
        {safetyStock > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-l-full"
            style={{
              width: pct(safetyStock),
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(194,65,45,.22) 0 3px, transparent 3px 6px)',
            }}
          />
        )}
        <div
          className={clsx(
            'runway-fill absolute inset-y-0 left-0 rounded-full',
            tone === 'ok' && 'bg-stock',
            tone === 'low' && 'bg-signal',
            tone === 'out' && 'bg-out',
          )}
          style={{ width: quantity === 0 ? '3px' : pct(quantity) }}
        />
        {reorderPoint > 0 && (
          <div
            className={clsx('absolute -top-1 -bottom-1 w-[2px] rounded bg-ink')}
            style={{ left: pct(reorderPoint) }}
            title={`Reorder point: ${reorderPoint}`}
          />
        )}
        {showLabels && reorderPoint > 0 && (
          <span
            className="absolute top-full mt-1.5 -translate-x-1/2 text-[11px] whitespace-nowrap text-muted"
            style={{ left: pct(reorderPoint) }}
          >
            Reorder at {reorderPoint.toLocaleString('en-IN')}
          </span>
        )}
      </div>
    </div>
  );
}
