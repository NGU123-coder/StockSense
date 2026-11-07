import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Pencil, Phone, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../api/client';
import { useSuppliers } from '../api/queries';
import type { Supplier } from '../api/types';
import { ErrorState, Field, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { inr } from '../lib/format';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the company name'),
  contactName: z.string().trim(),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  phone: z.string().trim(),
  city: z.string().trim(),
  leadTimeDays: z.coerce.number<string>().int().min(1, 'At least 1 day').max(120),
});
type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: supplier?.name ?? '',
      contactName: supplier?.contactName ?? '',
      email: supplier?.email ?? '',
      phone: supplier?.phone ?? '',
      city: supplier?.city ?? '',
      leadTimeDays: String(supplier?.leadTimeDays ?? 7),
    },
  });
  const save = useMutation({
    mutationFn: (v: Out) => (supplier ? api.patch(`/suppliers/${supplier.id}`, v) : api.post('/suppliers', v)),
    onSuccess: () => {
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? `Edit ${supplier.name}` : 'Add a supplier'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="supplier-form" disabled={save.isPending}>{supplier ? 'Save changes' : 'Add supplier'}</button>
        </>
      }
    >
      <form id="supplier-form" className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <div className="sm:col-span-2"><Field label="Company name" error={errors.name?.message}><input className="input" {...register('name')} /></Field></div>
        <Field label="Contact person"><input className="input" {...register('contactName')} /></Field>
        <Field label="City"><input className="input" {...register('city')} /></Field>
        <Field label="Email for purchase orders" error={errors.email?.message}><input className="input" type="email" {...register('email')} /></Field>
        <Field label="Phone"><input className="input" {...register('phone')} /></Field>
        <Field label="Lead time (days)" error={errors.leadTimeDays?.message} hint="Days from order to delivery. Drives reorder points.">
          <input className="input" type="number" min="1" {...register('leadTimeDays')} />
        </Field>
      </form>
    </Modal>
  );
}

export default function SuppliersPage() {
  const { data, isLoading, error, refetch } = useSuppliers();
  const { allowed } = useAuth();
  const [editing, setEditing] = useState<Supplier | null | 'new'>(null);

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Lead time is how many days a supplier takes to deliver. Longer lead times mean higher reorder points."
        actions={allowed('manageSuppliers') && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Add supplier</button>}
      />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Contact</th>
                <th className="text-right">Lead time</th>
                <th className="text-right">Products</th>
                <th className="text-right">Open orders</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={6}><Skeleton className="h-8" /></td></tr>)}
              {data?.map((s) => (
                <tr key={s.id}>
                  <td>
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-[12px] text-muted">{s.city}</p>
                  </td>
                  <td>
                    <p>{s.contactName ?? '—'}</p>
                    <div className="flex flex-wrap gap-3 text-[12px] text-muted">
                      {s.email && <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1 hover:text-sky"><Mail size={12} />{s.email}</a>}
                      {s.phone && <span className="inline-flex items-center gap-1"><Phone size={12} />{s.phone}</span>}
                    </div>
                  </td>
                  <td className="num text-right">{s.leadTimeDays} days</td>
                  <td className="num text-right">{s.productCount}</td>
                  <td className="num text-right">
                    {s.openPoCount > 0 ? (
                      <Link to="/purchase-orders?status=APPROVED" className="hover:underline">{s.openPoCount} worth {inr(s.openPoValue)}</Link>
                    ) : <span className="text-muted">None</span>}
                  </td>
                  <td>
                    {allowed('manageSuppliers') && (
                      <button className="rounded p-1.5 text-muted hover:bg-concrete hover:text-ink" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                        <Pencil size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
