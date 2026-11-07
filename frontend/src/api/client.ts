/**
 * Tiny fetch wrapper.
 * - The access token lives only in memory (not localStorage), so XSS can't read a long-lived secret.
 * - On a 401 it silently calls /auth/refresh once (the refresh token is an httpOnly cookie)
 *   and retries. Concurrent 401s share a single refresh request.
 */
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api';

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSessionExpired: () => void = () => {};

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function refreshSession(): Promise<string | null> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (r) => (r.ok ? ((await r.json()) as { accessToken: string }).accessToken : null))
    .catch(() => null)
    .then((t) => {
      setAccessToken(t);
      return t;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const token = await refreshSession();
    if (token) return request<T>(method, path, body, false);
    onSessionExpired();
  }
  if (res.status === 204) return undefined as T;

  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Opens a PDF from an authenticated endpoint in a new tab. */
export async function openPdf(path: string) {
  const win = window.open('', '_blank');
  const doFetch = () =>
    fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'include' });
  let res = await doFetch();
  if (res.status === 401 && (await refreshSession())) res = await doFetch();
  if (!res.ok) {
    win?.close();
    throw new ApiError(res.status, 'Could not generate the PDF');
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
}
