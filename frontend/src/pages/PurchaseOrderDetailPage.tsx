import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, FileText, Mail, PackageCheck, Send, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { api, openPdf } from '../api/client';
import type { PODetail, POStatus } from '../api/types';
import { POBadge } from '../components/Badges';
import { ErrorState, Modal, Skeleton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { date, inr, number, timeAgo } from '../lib/format';
import type { Permission } from '../lib/roles';

type Action = 'submit' | 'approve' | 'reject' | 'receive' | 'cancel';

const ACTIONS: Record<Action, { to: POStatus; label: string; done: string; perm: Permission; icon: typeof Check; confirm?: string }> = {
  submit: { to: 'SUBMITTED', label: 'Submit for approval', done: 'Submitted for approval', perm: 'createPO', icon: Send },
  approve: { to: 'APPROVED', label: 'Approve order', done: 'Order approved', perm: 'approvePO', icon: Check },
  receive: {
    to: 'RECEIVED',
    label: 'Mark as received',
    done: 'Goods received and added to stock',
    perm: 'receivePO',
    icon: PackageCheck,
    confirm: 'Every line will be added to stock at the delivery warehouse. This cannot be undone.',
  },
  reject: { to: 'DRAFT', label: 'Send back to draft', done: 'Sent back to draft', perm: 'approvePO', icon: Undo2 },
  cancel: { to: 'CANCELLED', label: 'Cancel order', done: 'Order cancelled', perm: 'createPO', icon: X, confirm: 'The supplier should be told separately.' },
};

/** The lifecycle really is a sequence, so it is drawn as numbered steps. */
function Timeline({ po }: { po: PODetail }) {
  const steps = [
    { label: 'Drafted', at: po.createdAt, by: po.createdBy },
    { label: 'Submitted', at: po.submittedAt },
    { label: 'Approved', at: po.approvedAt, by: po.approvedBy },
    { label: 'Received', at: po.receivedAt },
  ];
  const cancelled = po.status === 'CANCELLED';
  return (
    <ol className="grid gap-4 sm:grid-cols-4">
      {steps.map((s, i) => {
        const done = !!s.at;
        return (
          <li key={s.label} className="flex gap-3 sm:block">
            <div className="flex items-center gap-2 sm:mb-2">
              <span
                className={clsx(
                  'num grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold',
                  done ? 'bg-ink text-white' : 'border border-line-strong text-muted',
                )}
              >
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span className={clsx('hidden h-px flex-1 sm:block', i < 3 && (steps[i + 1].at ? 'bg-ink' : 'bg-line'), i === 3 && 'bg-transparent')} />
            </div>
            <div>
              <p className={clsx('text-[13px] font-semibold', !done && 'text-muted')}>{s.label}</p>
              <p className="text-[12px] text-muted">
                {done ? `${date(s.at)}${s.by ? `, ${s.by}` : ''}` : cancelled ? 'Cancelled' : 'Pending'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { allowed } = useAuth();
  const [confirming, setConfirming] = useState<Action | null>(null);
  const { data: po, error, refetch } = useQuery({ queryKey: ['purchase-order', id], queryFn: () => api.get<PODetail>(`/purchase-orders/${id}`) });

  const act = useMutation({
    mutationFn: (a: Action) => api.post<PODetail>(`/purchase-orders/${id}/${a}`),
    onSuccess: (data, a) => {
      qc.setQueryData(['purchase-order', id], data);
      ['purchase-orders', 'dashboard', 'products', 'product', 'recommendations'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(ACTIONS[a].done);
      setConfirming(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const email = useMutation({
    mutationFn: () => api.post<{ to: string }>(`/purchase-orders/${id}/email`),
    onSuccess: (r) => toast.success(`Purchase order emailed to ${r.to}`),
    onError: (e) => toast.error((e as Error).message),
  });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!po) return <Skeleton className="h-96" />;

  const available = (Object.keys(ACTIONS) as Action[]).filter((a) => po.allowedTransitions.includes(ACTIONS[a].to) && allowed(ACTIONS[a].perm));
  const primary = available.find((a) => a !== 'cancel' && a !== 'reject');
  const secondary = available.filter((a) => a !== primary);
  const run = (a: Action) => (ACTIONS[a].confirm ? setConfirming(a) : act.mutate(a));
  const overdue = po.status === 'APPROVED' && po.expectedDate && new Date(po.expectedDate) < new Date();

  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Back
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <POBadge status={po.status} />
            {overdue && <span className="text-[12px] font-semibold text-out">Delivery overdue</span>}
          </div>
          <h1 className="page-title">{po.poNumber}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {po.supplier.name} to {po.warehouse.name}, {po.warehouse.city}. Created {timeAgo(po.createdAt)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => openPdf(`/purchase-orders/${po.id}/pdf`).catch((e) => toast.error(e.message))}>
            <FileText size={15} /> PDF
          </button>
          {allowed('createPO') && ['SUBMITTED', 'APPROVED'].includes(po.status) && (
            <button className="btn-ghost" onClick={() => email.mutate()} disabled={email.isPending || !po.supplier.email}>
              <Mail size={15} /> {email.isPending ? 'Sending…' : 'Email supplier'}
            </button>
          )}
          {secondary.map((a) => {
            const A = ACTIONS[a];
            return (
              <button key={a} className={a === 'cancel' ? 'btn-danger' : 'btn-ghost'} onClick={() => run(a)} disabled={act.isPending}>
                <A.icon size={15} /> {A.label}
              </button>
            );
          })}
          {primary && (() => {
            const A = ACTIONS[primary];
            return (
              <button className="btn-primary" onClick={() => run(primary)} disabled={act.isPending}>
                <A.icon size={15} /> {A.label}
              </button>
            );
          })()}
        </div>
      </div>

      <section className="panel mb-5 p-5">
        <Timeline po={po} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <section className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table min-w-[620px]">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link to={`/products/${i.productId}`} className="font-semibold hover:underline">{i.name}</Link>
                      <div className="sku">{i.sku}</div>
                    </td>
                    <td className="num text-right">{number(i.quantity)} <span className="text-muted">{i.unit}</span></td>
                    <td className="num text-right">{inr(i.unitCost, { compact: false })}</td>
                    <td className="num text-right font-semibold">{inr(i.quantity * i.unitCost, { compact: false })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right font-semibold">Total</td>
                  <td className="num font-wide px-4 py-3 text-right text-[17px] font-[750]">{inr(po.totalAmount, { compact: false })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <aside className="panel divide-y divide-line text-[13px]">
          <div className="p-5">
            <p className="label">Supplier</p>
            <p className="font-semibold">{po.supplier.name}</p>
            {po.supplier.contactName && <p className="text-muted">{po.supplier.contactName}</p>}
            {po.supplier.email && <a className="block text-sky hover:underline" href={`mailto:${po.supplier.email}`}>{po.supplier.email}</a>}
            {po.supplier.phone && <p className="text-muted">{po.supplier.phone}</p>}
          </div>
          <div className="p-5">
            <p className="label">Deliver to</p>
            <p className="font-semibold">{po.warehouse.name}</p>
            <p className="text-muted">{po.warehouse.city}</p>
          </div>
          <div className="p-5">
            <p className="label">Expected delivery</p>
            <p className={clsx('font-semibold', overdue && 'text-out')}>{date(po.expectedDate)}</p>
            <p className="text-muted">{po.supplier.leadTimeDays} day supplier lead time</p>
          </div>
          {po.notes && (
            <div className="p-5">
              <p className="label">Notes</p>
              <p>{po.notes}</p>
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming ? `${ACTIONS[confirming].label}?` : ''}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirming(null)}>Keep as is</button>
            {confirming && (
              <button className={confirming === 'cancel' ? 'btn-danger' : 'btn-primary'} onClick={() => act.mutate(confirming)} disabled={act.isPending}>
                {ACTIONS[confirming].label}
              </button>
            )}
          </>
        }
      >
        <p className="text-[13.5px]">{confirming && ACTIONS[confirming].confirm}</p>
        {confirming === 'receive' && (
          <ul className="mt-3 space-y-1 text-[13px] text-muted">
            {po.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span>{i.name}</span>
                <span className="num font-semibold text-stock">+{number(i.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
