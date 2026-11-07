import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[70ch] text-[14px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-line/60', className)} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <svg width="56" height="44" viewBox="0 0 56 44" aria-hidden className="mb-4 text-line-strong">
        <rect x="2" y="16" width="24" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="30" y="2" width="24" height="40" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M2 24h24M30 12h24" stroke="currentColor" strokeWidth="2" />
      </svg>
      <p className="font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-6">
      <p className="font-semibold text-out">This page couldn't load</p>
      <p className="text-[13px] text-muted">{(error as Error)?.message ?? 'Check that the API server is running.'}</p>
      {onRetry && (
        <button className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        'm-auto w-[calc(100%-32px)] rounded-[var(--radius-lg)] border border-line bg-surface p-0 text-ink shadow-[0_24px_60px_-20px_rgba(20,33,61,.35)] backdrop:bg-ink/40',
        width,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="section-title">{title}</h2>
            <button className="rounded p-1 text-muted hover:bg-concrete hover:text-ink" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="mt-1 text-[12px] text-faint">{hint}</p> : null}
    </label>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors',
            value === it.value ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {it.label}
          {it.count !== undefined && (
            <span
              className={clsx(
                'num rounded-full px-1.5 text-[11px]',
                value === it.value ? 'bg-ink text-white' : 'bg-concrete text-muted',
              )}
            >
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
