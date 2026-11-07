import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../api/client';
import { useSuppliers, useWarehouses } from '../api/queries';
import type { PODetail, ProductDetail } from '../api/types';
import { ProductPicker } from '../components/ProductPicker';
import { Field, PageHeader } from '../components/ui';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { inr } from '../lib/format';

const schema = z.object({
  supplierId: z.string().min(1, 'Choose a supplier'),
  warehouseId: z.string().min(1, 'Choose where to deliver'),
  expectedDate: z.string(),
  notes: z.string().max(1000),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'Choose a product'),
        name: z.string(),
        sku: z.string(),
        quantity: z.coerce.number<string>().int('Whole units').positive('More than 0'),
        unitCost: z.coerce.number<string>().positive('More than 0'),
      }),
    )
    .min(1, 'Add at least one item'),
});
type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

export default function NewPurchaseOrderPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { warehouseId: scopeId } = useWarehouseScope();
  const { data: suppliers } = useSuppliers();
  const { data: warehouses } = useWarehouses();
  const presetProduct = params.get('product');
  const presetWarehouse = params.get('warehouse') ?? scopeId ?? '';

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: { supplierId: '', warehouseId: presetWarehouse, expectedDate: '', notes: '', items: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const supplierId = watch('supplierId');
  const items = watch('items');
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitCost) || 0), 0);
  const supplier = suppliers?.find((s) => s.id === supplierId);

  // "Order more" from a product page: pre-fill supplier, product and the forecast's suggested quantity.
  const preset = useQuery({
    queryKey: ['product', presetProduct],
    queryFn: () => api.get<ProductDetail>(`/products/${presetProduct}`),
    enabled: !!presetProduct,
  });
  useEffect(() => {
    const p = preset.data;
    if (!p || getValues('items').length) return;
    if (p.supplierId) setValue('supplierId', p.supplierId);
    const wh = p.stock.find((s) => s.warehouseId === presetWarehouse);
    const suggested = wh?.forecast?.recommendedOrderQty || Math.ceil((wh?.forecast?.avgDailyDemand ?? 10) * 14);
    append({ productId: p.id, name: p.name, sku: p.sku, quantity: String(suggested), unitCost: String(p.costPrice) });
  }, [preset.data, presetWarehouse, append, setValue, getValues]);

  // Changing supplier clears lines from the old supplier.
  const onSupplierChange = (id: string) => {
    if (getValues('items').length && !confirm('Changing the supplier removes the items already added. Continue?')) return;
    setValue('supplierId', id, { shouldValidate: true });
    setValue('items', []);
  };

  const create = useMutation({
    mutationFn: (v: Out) =>
      api.post<PODetail>('/purchase-orders', {
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        expectedDate: v.expectedDate || null,
        notes: v.notes || null,
        items: v.items.map(({ productId, quantity, unitCost }) => ({ productId, quantity, unitCost })),
      }),
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success(`${po.poNumber} saved as draft`);
      navigate(`/purchase-orders/${po.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Back
      </button>
      <PageHeader title="New purchase order" subtitle="Saved as a draft. Submit it for approval when it's ready." />

      <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <section className="panel grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Supplier" error={errors.supplierId?.message}>
              <select className="input" value={supplierId} onChange={(e) => onSupplierChange(e.target.value)}>
                <option value="">Choose a supplier…</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Deliver to" error={errors.warehouseId?.message}>
              <select className="input" {...register('warehouseId')}>
                <option value="">Choose a warehouse…</option>
                {warehouses?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expected delivery" hint={supplier ? `Leave empty to use the ${supplier.leadTimeDays} day lead time` : undefined}>
              <input className="input" type="date" {...register('expectedDate')} min={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="Notes for the supplier">
              <input className="input" {...register('notes')} placeholder="Optional" />
            </Field>
          </section>

          <section className="panel">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="section-title">Items</h2>
              {errors.items?.root?.message || errors.items?.message ? (
                <p className="field-error mt-0">{errors.items?.root?.message ?? errors.items?.message}</p>
              ) : null}
            </div>
            {fields.length > 0 && (
              <div className="overflow-x-auto">
                <table className="table min-w-[620px]">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="w-[130px]">Quantity</th>
                      <th className="w-[140px]">Unit cost (₹)</th>
                      <th className="w-[120px] text-right">Amount</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, i) => (
                      <tr key={f.id}>
                        <td>
                          <p className="font-semibold">{f.name}</p>
                          <p className="sku">{f.sku}</p>
                        </td>
                        <td>
                          <input className="input" type="number" min="1" step="1" {...register(`items.${i}.quantity`)} aria-label={`Quantity of ${f.name}`} />
                          {errors.items?.[i]?.quantity && <p className="field-error">{errors.items[i]?.quantity?.message}</p>}
                        </td>
                        <td>
                          <input className="input" type="number" min="0" step="0.01" {...register(`items.${i}.unitCost`)} aria-label={`Unit cost of ${f.name}`} />
                        </td>
                        <td className="num text-right font-semibold">
                          {inr((Number(items[i]?.quantity) || 0) * (Number(items[i]?.unitCost) || 0), { compact: false })}
                        </td>
                        <td>
                          <button type="button" onClick={() => remove(i)} className="rounded p-1.5 text-muted hover:bg-out-soft hover:text-out" aria-label={`Remove ${f.name}`}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-3 px-5 py-4">
              <Plus size={16} className="shrink-0 text-muted" />
              <div className="flex-1">
                {supplierId ? (
                  <ProductPicker
                    supplierId={supplierId}
                    exclude={items.map((i) => i.productId)}
                    placeholder={`Add a product from ${supplier?.name ?? 'this supplier'}`}
                    onChange={(id, p) =>
                      append({ productId: id, name: p.name, sku: p.sku, quantity: String(p.recommendedOrderQty || 50), unitCost: String(p.costPrice) })
                    }
                  />
                ) : (
                  <p className="text-[13px] text-muted">Choose a supplier first to add their products.</p>
                )}
              </div>
            </div>
          </section>
        </div>

        <aside className="panel h-fit p-5 xl:sticky xl:top-[84px]">
          <p className="text-[12.5px] text-muted">Order total</p>
          <p className="num font-wide mt-1 text-[28px] font-[750]">{inr(total, { compact: false })}</p>
          <p className="mt-1 text-[12.5px] text-muted">
            {fields.length} {fields.length === 1 ? 'item' : 'items'}
            {supplier ? ` from ${supplier.name}` : ''}
          </p>
          <button type="submit" className="btn-primary mt-5 h-10 w-full" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save draft'}
          </button>
          <p className="mt-3 text-[12px] text-muted">A manager approves the order before it goes to the supplier.</p>
        </aside>
      </form>
    </>
  );
}
