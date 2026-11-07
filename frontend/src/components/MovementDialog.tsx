import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../api/client';
import { useWarehouses } from '../api/queries';
import { ProductPicker } from './ProductPicker';
import { Field, Modal } from './ui';

export type MovementKind = 'RECEIPT' | 'SALE' | 'ADJUSTMENT' | 'TRANSFER';

const kinds: { value: MovementKind; label: string; help: string }[] = [
  { value: 'RECEIPT', label: 'Receive', help: 'Goods arrived without a purchase order' },
  { value: 'SALE', label: 'Dispatch', help: 'Goods sold or sent to a customer' },
  { value: 'TRANSFER', label: 'Transfer', help: 'Move stock to another warehouse' },
  { value: 'ADJUSTMENT', label: 'Adjust', help: 'Count correction, damage or expiry. Use a minus sign to remove.' },
];

const schema = z
  .object({
    kind: z.enum(['RECEIPT', 'SALE', 'ADJUSTMENT', 'TRANSFER']),
    productId: z.string().min(1, 'Choose a product'),
    warehouseId: z.string().min(1, 'Choose a warehouse'),
    toWarehouseId: z.string(),
    quantity: z.coerce.number<string>().int('Whole units only').refine((n) => n !== 0, 'Enter a quantity'),
    note: z.string().max(300),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== 'ADJUSTMENT' && v.quantity < 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a positive quantity' });
    if (v.kind === 'TRANSFER' && !v.toWarehouseId)
      ctx.addIssue({ code: 'custom', path: ['toWarehouseId'], message: 'Choose the destination' });
    if (v.kind === 'TRANSFER' && v.toWarehouseId === v.warehouseId)
      ctx.addIssue({ code: 'custom', path: ['toWarehouseId'], message: 'Pick a different warehouse' });
    if (v.kind === 'ADJUSTMENT' && v.quantity < 0 && !v.note.trim())
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say why stock is being written off' });
  });

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

export function MovementDialog({
  open,
  onClose,
  productId,
  productLabel,
  warehouseId,
  initialKind = 'RECEIPT',
  toWarehouseId,
  quantity,
}: {
  open: boolean;
  onClose: () => void;
  productId?: string;
  productLabel?: string;
  warehouseId?: string | null;
  initialKind?: MovementKind;
  toWarehouseId?: string;
  quantity?: number;
}) {
  const qc = useQueryClient();
  const { data: warehouses } = useWarehouses();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    values: {
      kind: initialKind,
      productId: productId ?? '',
      warehouseId: warehouseId ?? '',
      toWarehouseId: toWarehouseId ?? '',
      quantity: quantity ? String(quantity) : '',
      note: '',
    },
  });
  const kind = watch('kind');

  const save = useMutation({
    mutationFn: (v: Out) =>
      v.kind === 'TRANSFER'
        ? api.post('/stock/transfers', {
            productId: v.productId,
            fromWarehouseId: v.warehouseId,
            toWarehouseId: v.toWarehouseId,
            quantity: v.quantity,
            note: v.note || undefined,
          })
        : api.post('/stock/movements', {
            productId: v.productId,
            warehouseId: v.warehouseId,
            type: v.kind,
            quantity: v.quantity,
            note: v.note || undefined,
          }),
    onSuccess: (_r, v) => {
      const verb = { RECEIPT: 'Received', SALE: 'Dispatched', TRANSFER: 'Transferred', ADJUSTMENT: 'Adjusted' }[v.kind];
      toast.success(`${verb} ${Math.abs(v.quantity)} units`);
      ['products', 'product', 'dashboard', 'movements', 'warehouses', 'product-movements'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      reset();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a stock movement"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" form="movement-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save movement'}
          </button>
        </>
      }
    >
      <form id="movement-form" className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <div className="grid grid-cols-4 gap-1 rounded-[var(--radius-md)] bg-concrete p-1" role="radiogroup" aria-label="Movement type">
          {kinds.map((k) => (
            <button
              type="button"
              key={k.value}
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setValue('kind', k.value)}
              className={clsx(
                'rounded-[6px] py-1.5 text-[13px] font-semibold transition-colors',
                kind === k.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(20,33,61,.12)]' : 'text-muted hover:text-ink',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="-mt-2 text-[12px] text-muted">{kinds.find((k) => k.value === kind)?.help}</p>

        {productId ? (
          <Field label="Product">
            <input className="input bg-concrete" value={productLabel} readOnly />
          </Field>
        ) : (
          <Field label="Product" error={errors.productId?.message}>
            <ProductPicker value={watch('productId')} onChange={(id) => setValue('productId', id, { shouldValidate: true })} />
          </Field>
        )}

        <div className={clsx('grid gap-4', kind === 'TRANSFER' && 'sm:grid-cols-2')}>
          <Field label={kind === 'TRANSFER' ? 'From warehouse' : 'Warehouse'} error={errors.warehouseId?.message}>
            <select className="input" {...register('warehouseId')}>
              <option value="">Choose…</option>
              {warehouses?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          {kind === 'TRANSFER' && (
            <Field label="To warehouse" error={errors.toWarehouseId?.message}>
              <select className="input" {...register('toWarehouseId')}>
                <option value="">Choose…</option>
                {warehouses?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <Field label="Quantity" error={errors.quantity?.message}>
          <input className="input" type="number" step="1" {...register('quantity')} placeholder={kind === 'ADJUSTMENT' ? 'e.g. −4' : 'e.g. 120'} />
        </Field>
        <Field label="Note" error={errors.note?.message}>
          <input className="input" {...register('note')} placeholder="Optional, e.g. invoice number or reason" />
        </Field>
      </form>
    </Modal>
  );
}
