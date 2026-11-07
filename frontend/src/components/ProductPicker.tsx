import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../api/client';
import type { ProductList, ProductRow } from '../api/types';
import { useDebounced } from '../hooks/useDebounced';
import { inr } from '../lib/format';

/** Accessible type-ahead product search (combobox pattern). */
export function ProductPicker({
  value,
  onChange,
  supplierId,
  exclude = [],
  placeholder = 'Search by name, SKU or barcode',
}: {
  value?: string;
  onChange: (id: string, product: ProductRow) => void;
  supplierId?: string;
  exclude?: string[];
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text, 200);
  const box = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['products', 'picker', q, supplierId],
    queryFn: () => api.get<ProductList>(`/products${qs({ q, supplierId, pageSize: 12 })}`),
    enabled: open,
  });
  const options = (data?.items ?? []).filter((p) => !exclude.includes(p.id));

  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  useEffect(() => {
    if (!value) setText('');
  }, [value]);

  const choose = (p: ProductRow) => {
    onChange(p.id, p);
    setText(p.name);
    setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && options.length > 0 && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-md)] border border-line bg-surface py-1 shadow-[0_16px_40px_-16px_rgba(20,33,61,.35)]">
          {options.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={clsx('flex cursor-pointer items-center justify-between gap-3 px-3 py-2', i === active && 'bg-concrete')}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{p.name}</span>
                <span className="sku">{p.sku}</span>
              </span>
              <span className="num shrink-0 text-[12px] text-muted">{inr(p.costPrice)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
