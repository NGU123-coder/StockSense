import clsx from 'clsx';
import type { MovementType, POStatus, StockStatus } from '../api/types';

const base = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap';

export function StockBadge({ status, detail }: { status: StockStatus; detail?: string }) {
  const map = {
    ok: ['bg-stock-soft text-stock', 'Healthy'],
    low: ['bg-signal-soft text-signal-ink', 'Reorder'],
    out: ['bg-out-soft text-out', 'Out of stock'],
  } as const;
  const [cls, label] = map[status];
  return (
    <span className={clsx(base, cls)}>
      <span className="size-1.5 rounded-full bg-current" />
      {detail ?? label}
    </span>
  );
}

const poStyles: Record<POStatus, string> = {
  DRAFT: 'bg-concrete text-muted ring-1 ring-line',
  SUBMITTED: 'bg-signal-soft text-signal-ink',
  APPROVED: 'bg-sky-soft text-sky',
  RECEIVED: 'bg-stock-soft text-stock',
  CANCELLED: 'bg-out-soft text-out',
};
export const poLabel: Record<POStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export function POBadge({ status }: { status: POStatus }) {
  return <span className={clsx(base, poStyles[status])}>{poLabel[status]}</span>;
}

export const movementLabel: Record<MovementType, string> = {
  RECEIPT: 'Received',
  SALE: 'Sold',
  ADJUSTMENT: 'Adjusted',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
};
