import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { getAccessToken, refreshSession } from '../api/client';
import type { Alert } from '../api/types';

/**
 * Subscribes to server events over Socket.io and keeps cached data fresh:
 * stock changes, new alerts and finished forecast runs update every open screen.
 */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const socket = io(import.meta.env.VITE_API_URL || undefined, {
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
    });
    socket.on('connect_error', async (err) => {
      if (err.message === 'unauthorized' && (await refreshSession())) socket.connect();
    });

    const refresh = (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

    socket.on('stock:changed', () => refresh('dashboard', 'products', 'product', 'movements', 'warehouses'));
    socket.on('po:changed', () => refresh('purchase-orders', 'purchase-order', 'dashboard', 'suppliers'));
    socket.on('alert:resolved', () => refresh('alerts'));
    socket.on('alert:new', (a: Alert & { productName: string; warehouseName: string }) => {
      refresh('alerts');
      const title = a.type === 'OUT_OF_STOCK' ? 'Out of stock' : 'Running low';
      toast.warning(`${title}: ${a.productName}`, { description: a.warehouseName });
    });
    // Targeted re-forecast after a stock or PO change: refresh quietly.
    socket.on('forecast:updated', () => refresh('recommendations', 'dashboard', 'products', 'product', 'product-history', 'alerts'));
    socket.on('forecast:completed', (e: { count: number }) => {
      refresh('dashboard', 'products', 'product', 'recommendations', 'forecast-status', 'product-history', 'alerts');
      toast.success('Forecasts updated', { description: `${e.count} product–warehouse forecasts recalculated` });
    });

    return () => {
      socket.disconnect();
    };
  }, [enabled, qc]);
}
