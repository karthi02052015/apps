import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';
import { authStore } from './authStore';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  beforeEach(() => authStore.signIn({ id: 'u', email: 'a@b.co', name: 'A', role: 'user', timezone: 'UTC', createdAt: '' }, 'old-token'));
  afterEach(() => vi.restoreAllMocks());

  it('sends the bearer token and time zone', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }));
    await api('/tasks', { query: { view: 'today', priority: ['high', 'urgent'], empty: undefined } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/tasks?view=today&priority=high%2Curgent');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer old-token');
    expect(headers['X-Timezone']).toBeTruthy();
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { user: { id: 'u' }, accessToken: 'new-token', expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { items: [] }));
    const res = await api<{ items: unknown[] }>('/tasks');
    expect(res.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/auth/refresh');
    expect((fetchMock.mock.calls[2]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer new-token');
  });

  it('signs out when refresh fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'nope' } }));
    await expect(api('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(authStore.get().status).toBe('anonymous');
  });

  it('normalises server errors and network failures into friendly messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json(422, { error: { code: 'VALIDATION_ERROR', message: 'Title is required', details: [{ path: 'title', message: 'Required' }] } }),
    );
    const err = await api('/tasks', { method: 'POST', body: {} }).catch((e: ApiError) => e);
    expect(err).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', message: 'Title is required' });
    expect((err as ApiError).fieldError('title')).toBe('Required');

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const net = await api('/tasks').catch((e: ApiError) => e);
    expect((net as ApiError).isNetwork).toBe(true);
  });
});
