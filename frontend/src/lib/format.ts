/** Indian number formatting: ₹2.03 Cr, ₹47.6 L, ₹8,450. */
export function inr(value: number, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? true;
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (compact && abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (compact && abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: abs < 1000 ? 2 : 0 })}`;
}

function trim(n: number) {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

export const number = (n: number, digits = 0) =>
  n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const percent = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : `${(n * 100).toFixed(digits)}%`;

export function signedPercent(n: number | null | undefined) {
  if (n == null) return '—';
  const v = n * 100;
  if (Math.abs(v) < 0.05) return '0.0%';
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
}

export const date = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const shortDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function timeAgo(d: string | Date): string {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} d ago`;
  return date(d);
}

export function days(n: number | null | undefined) {
  if (n == null) return '—';
  if (n === 0) return 'Out now';
  if (n < 1) return '< 1 day';
  if (n > 365) return '1 yr +';
  return `${Math.round(n)} ${Math.round(n) === 1 ? 'day' : 'days'}`;
}

/** "1 bag", "963 bags", "12 kg" — units that are abbreviations never take an s. */
export function units(n: number, unit: string) {
  const label = n === 1 || /^(kg|g|l|ml|pcs)$/i.test(unit) ? unit : unit.endsWith('x') ? `${unit}es` : `${unit}s`;
  return `${number(n)} ${label}`;
}
