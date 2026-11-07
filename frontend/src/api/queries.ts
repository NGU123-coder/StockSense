import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Alert, ForecastStatus, Supplier, Warehouse } from './types';

export const useWarehouses = () =>
  useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/warehouses'), staleTime: 60_000 });

export const useSuppliers = () =>
  useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers'), staleTime: 60_000 });

export const useAlerts = () =>
  useQuery({ queryKey: ['alerts'], queryFn: () => api.get<Alert[]>('/alerts'), refetchInterval: 120_000 });

export const useForecastStatus = () =>
  useQuery({
    queryKey: ['forecast-status'],
    queryFn: () => api.get<ForecastStatus>('/forecasts/status'),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 60_000),
  });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api.get<string[]>('/products/categories'), staleTime: 300_000 });
