import type { ApiErrorBody, AuthResponse } from '@taskflow/shared';
import { authStore } from './authStore';

const BASE = '/api/v1';
const TIMEOUT_MS = 15_000;

/** Normalised error surfaced to the UI. `message` is always safe and human-readable. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }
  fieldError(path: string) {
    return this.details?.find((d) => d.path === path)?.message;
  }
}

export const timeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  signal?: AbortSignal;
  /** Internal: prevents infinite refresh loops. */
  retried?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) params.set(k, v.join(','));
    } else params.set(k, String(v));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON (proxy error page etc.) */
  }
  const e = body?.error;
  const fallback =
    res.status >= 500 ? 'The server had a problem. Please try again in a moment.' : `Request failed (${res.status}).`;
  return new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? fallback, e?.details, e?.requestId);
}

async function rawFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal, credentials: 'same-origin' });
  } catch (err) {
    if (signal?.aborted) throw err; // caller cancelled — let React Query handle it
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError(0, 'TIMEOUT', 'The request took too long. Check your connection and try again.');
    }
    if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT', 'The request took too long. Check your connection and try again.');
    throw new ApiError(0, 'NETWORK_ERROR', navigator.onLine ? "Can't reach TaskFlow right now. Please try again." : "You're offline. Changes will sync when you reconnect.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------- refresh

let refreshing: Promise<AuthResponse | null> | null = null;

async function doRefresh(): Promise<AuthResponse | null> {
  const res = await rawFetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'taskflow', 'X-Timezone': timeZone },
  });
  if (!res.ok) return null;
  return (await res.json()) as AuthResponse;
}

/**
 * Single-flight refresh, coordinated across tabs with the Web Locks API when
 * available so two tabs never rotate the same refresh token simultaneously.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const run = () => doRefresh();
      const result =
        typeof navigator !== 'undefined' && 'locks' in navigator
          ? await navigator.locks.request('taskflow-refresh', run)
          : await run();
      if (result) authStore.signIn(result.user, result.accessToken);
      else authStore.signOut();
      return result;
    } catch (err) {
      // Network failure during refresh: keep the user signed in state as-is; retry later.
      if (err instanceof ApiError && err.isNetwork) throw err;
      authStore.signOut();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------------------------------------------------------------- request

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = authStore.get().accessToken;
  const headers: Record<string, string> = { 'X-Timezone': timeZone, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await rawFetch(
    buildUrl(path, opts.query),
    { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined },
    opts.signal,
  );

  if (res.status === 401 && !opts.retried && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...opts, retried: true });
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Friendly message for any thrown value. */
export const errorMessage = (err: unknown): string =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.';
