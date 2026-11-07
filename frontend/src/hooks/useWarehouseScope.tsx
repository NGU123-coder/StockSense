import { createContext, useContext, useState, type ReactNode } from 'react';

/** The warehouse selected in the top bar. null = all warehouses. Remembered per browser. */
interface Scope {
  warehouseId: string | null;
  setWarehouseId: (id: string | null) => void;
}

const ScopeContext = createContext<Scope | null>(null);
const KEY = 'ss.warehouse';

function readStored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function WarehouseScopeProvider({ children }: { children: ReactNode }) {
  const [warehouseId, setState] = useState<string | null>(readStored);
  const setWarehouseId = (id: string | null) => {
    setState(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  };
  return <ScopeContext.Provider value={{ warehouseId, setWarehouseId }}>{children}</ScopeContext.Provider>;
}

export function useWarehouseScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useWarehouseScope must be used inside WarehouseScopeProvider');
  return ctx;
}
