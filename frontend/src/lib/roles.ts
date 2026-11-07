import type { Role } from '../api/types';

/** Mirrors the backend's permission table so the UI only shows actions a user can take. */
export const can = {
  manageUsers: ['ADMIN'],
  manageCatalog: ['ADMIN', 'MANAGER'],
  moveStock: ['ADMIN', 'MANAGER'],
  createPO: ['ADMIN', 'MANAGER', 'PURCHASER'],
  approvePO: ['ADMIN', 'MANAGER'],
  receivePO: ['ADMIN', 'MANAGER'],
  runForecast: ['ADMIN', 'MANAGER'],
  manageSuppliers: ['ADMIN', 'MANAGER', 'PURCHASER'],
} satisfies Record<string, Role[]>;

export type Permission = keyof typeof can;

export const roleLabel: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Warehouse manager',
  PURCHASER: 'Purchase officer',
  VIEWER: 'Viewer',
};
