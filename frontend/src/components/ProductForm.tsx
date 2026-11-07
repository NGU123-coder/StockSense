import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, ApiError } from '../api/client';
import { useCategories, useSuppliers } from '../api/queries';
import type { ProductDetail } from '../api/types';
import { Field, Modal } from './ui';

const schema = z
  .object({
    sku: z.string().trim().min(3, 'At least 3 characters').max(32),
    name: z.string().trim().min(2, 'Enter a product name'),
    category: z.string().trim().min(2, 'Enter a category'),
    unit: z.string().trim().min(1),
    barcode: z.string().trim().regex(/^(\d{8,14})?$/, 'Barcode must be 8–14 digits, or leave empty'),
    costPrice: z.coerce.number<string>().positive('Must be more than 0'),
    sellPrice: z.coerce.number<string>().positive('Must be more than 0'),
    supplierId: z.string(),
  })
  .refine((v) => v.sellPrice >= v.costPrice, { message: 'Selling price is below cost', path: ['sellPrice'] });

type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

export function ProductForm({ open, onClose, product }: { open: boolean; onClose: () => void; product?: ProductDetail }) {
  const qc = useQueryClient();
  const { data: suppliers } = useSuppliers();
  const { data: categories } = useCategories();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    values: product
      ? {
          sku: product.sku,
          name: product.name,
          category: product.category,
          unit: product.unit,
          barcode: product.barcode ?? '',
          costPrice: String(product.costPrice),
          sellPrice: String(product.sellPrice),
          supplierId: product.supplierId ?? '',
        }
      : { sku: '', name: '', category: '', unit: 'pcs', barcode: '', costPrice: '', sellPrice: '', supplierId: '' },
  });

  const save = useMutation({
    mutationFn: (v: Output) => {
      const body = { ...v, barcode: v.barcode || null, supplierId: v.supplierId || null };
      return product ? api.patch(`/products/${product.id}`, body) : api.post<{ id: string }>('/products', body);
    },
    onSuccess: () => {
      toast.success(product ? 'Product updated' : 'Product added');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      reset();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setError('sku', { message: 'This SKU or barcode is already in use' });
      else toast.error((e as Error).message);
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? `Edit ${product.name}` : 'Add a product'}
      width="max-w-xl"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" form="product-form" disabled={save.isPending}>
            {product ? 'Save changes' : 'Add product'}
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Field label="Product name" error={errors.name?.message}>
            <input className="input" {...register('name')} placeholder="Sunflower Oil 1 L" />
          </Field>
        </div>
        <Field label="SKU" error={errors.sku?.message}>
          <input className="input uppercase" {...register('sku')} placeholder="STP-OIL-1" />
        </Field>
        <Field label="Barcode" error={errors.barcode?.message} hint="Leave empty to generate an EAN-13">
          <input className="input" {...register('barcode')} inputMode="numeric" />
        </Field>
        <Field label="Category" error={errors.category?.message}>
          <input className="input" {...register('category')} list="category-list" />
          <datalist id="category-list">{categories?.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Unit" error={errors.unit?.message}>
          <input className="input" {...register('unit')} list="unit-list" />
          <datalist id="unit-list">
            {['pcs', 'pack', 'bag', 'bottle', 'box', 'jar', 'tin', 'tube', 'pouch', 'kg', 'L'].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Cost price (₹)" error={errors.costPrice?.message}>
          <input className="input" {...register('costPrice')} type="number" step="0.01" min="0" />
        </Field>
        <Field label="Selling price (₹)" error={errors.sellPrice?.message}>
          <input className="input" {...register('sellPrice')} type="number" step="0.01" min="0" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Supplier">
            <select className="input" {...register('supplierId')}>
              <option value="">No supplier</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.leadTimeDays} day lead time)
                </option>
              ))}
            </select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
