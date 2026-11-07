import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../api/client';
import { useWarehouses } from '../api/queries';
import { ErrorState, Field, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { inr, number } from '../lib/format';

const schema = z.object({
  code: z.string().trim().min(2, '2 to 10 letters').max(10),
  name: z.string().trim().min(2, 'Enter a name'),
  city: z.string().trim().min(2, 'Enter the city'),
  address: z.string().trim(),
});
type V = z.infer<typeof schema>;

function AddWarehouse({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { code: '', name: '', city: '', address: '' } });
  const save = useMutation({
    mutationFn: (v: V) => api.post('/warehouses', v),
    onSuccess: () => {
      toast.success('Warehouse added');
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal open onClose={onClose} title="Add a warehouse" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" form="wh-form">Add warehouse</button></>}>
      <form id="wh-form" className="grid gap-4 sm:grid-cols-[120px_1fr]" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Code" error={errors.code?.message}><input className="input uppercase" {...register('code')} placeholder="HYD" /></Field>
        <Field label="Name" error={errors.name?.message}><input className="input" {...register('name')} placeholder="Hyderabad DC" /></Field>
        <div className="sm:col-span-2"><Field label="City" error={errors.city?.message}><input className="input" {...register('city')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Address"><input className="input" {...register('address')} /></Field></div>
      </form>
    </Modal>
  );
}

export default function WarehousesPage() {
  const { data, isLoading, error, refetch } = useWarehouses();
  const { allowed } = useAuth();
  const { setWarehouseId } = useWarehouseScope();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const total = data?.reduce((s, w) => s + w.stockValue, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Warehouses"
        subtitle="Stock value and shortages at each location. Open one to scope the whole app to it."
        actions={allowed('manageCatalog') && <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add warehouse</button>}
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      <div className="grid gap-4 md:grid-cols-2">
        {isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-44" />)}
        {data?.map((w) => {
          const share = total ? w.stockValue / total : 0;
          return (
            <article key={w.id} className="panel flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-wide text-[18px] font-[750]">{w.name}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-muted"><MapPin size={13} />{w.city}</p>
                </div>
                <span className="font-wide rounded-[var(--radius-sm)] bg-ink px-2 py-1 text-[12px] font-bold text-white">{w.code}</span>
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-4">
                <div><dt className="text-[12px] text-muted">Stock value</dt><dd className="num font-wide text-[18px] font-[700]">{inr(w.stockValue)}</dd></div>
                <div><dt className="text-[12px] text-muted">Units</dt><dd className="num font-wide text-[18px] font-[700]">{number(w.totalUnits)}</dd></div>
                <div><dt className="text-[12px] text-muted">Need reorder</dt><dd className={`num font-wide text-[18px] font-[700] ${w.lowStockCount ? 'text-signal-ink' : 'text-stock'}`}>{w.lowStockCount}</dd></div>
              </dl>
              <div className="mt-4">
                <div className="h-1.5 rounded-full bg-concrete"><div className="runway-fill h-full rounded-full bg-ink-3" style={{ width: `${share * 100}%` }} /></div>
                <p className="mt-1 text-[12px] text-muted">{Math.round(share * 100)}% of company stock value</p>
              </div>
              <div className="mt-4 flex gap-2 border-t border-line pt-4">
                <button className="btn-ghost h-8" onClick={() => { setWarehouseId(w.id); navigate('/'); }}>View overview</button>
                <button className="btn-ghost h-8" onClick={() => { setWarehouseId(w.id); navigate('/products?status=low'); }}>Items to reorder</button>
              </div>
            </article>
          );
        })}
      </div>
      {adding && <AddWarehouse onClose={() => setAdding(false)} />}
    </>
  );
}
