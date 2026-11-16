import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient, configureApiClient, dataVersion, forgetReads, rememberRead } from '../src/lib/apiClient';

// Phase 0 of docs/AUDIT_2026-11.md: reads are shared while in flight and kept a few seconds, and every change forgets them.
const json = (status, body) => new Response(JSON.stringify(body), { status });
const counted = (answer) => {
  const fetchMock = vi.fn(async (url, init) => answer(String(url), init?.method ?? 'GET'));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
beforeEach(() => forgetReads());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  configureApiClient({ onUnauthorized: () => {} });
});

describe('reads are shared and remembered', () => {
  it('two screens asking at once cost one call, and each gets its own copy', async () => {
    const f = counted(() => json(200, { data: [{ id: 1 }] }));
    const [a, b] = await Promise.all([apiClient.get('/v1/businesses'), apiClient.get('/v1/businesses')]);
    expect(f).toHaveBeenCalledTimes(1);
    a.data.push({ id: 2 }); // a screen that sorts or edits what it was given must not change the other's list
    expect(b.data).toEqual([{ id: 1 }]);
    expect((await apiClient.get('/v1/businesses')).data).toEqual([{ id: 1 }]);
  });

  it('a read is remembered for a few seconds and then asked again', async () => {
    vi.useFakeTimers();
    const f = counted(() => json(200, { n: 1 }));
    await apiClient.get('/v1/settings');
    await apiClient.get('/v1/settings');
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_500);
    await apiClient.get('/v1/settings');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a different address or query is a different read', async () => {
    const f = counted(() => json(200, {}));
    await apiClient.get('/v1/items');
    await apiClient.get('/v1/items', { query: { q: 'pen' } });
    await apiClient.get('/v1/items', { query: { q: 'ink' } });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('"fresh" and a cancellable read always go to the server', async () => {
    const f = counted(() => json(200, {}));
    await apiClient.get('/v1/me');
    await apiClient.get('/v1/me', { fresh: true });
    await apiClient.get('/v1/me', { signal: new AbortController().signal });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('a failed read is not remembered, and every caller of it sees the failure', async () => {
    let n = 0;
    const f = counted(() => (++n === 1 ? json(500, { message: 'down' }) : json(200, { ok: true })));
    await expect(apiClient.get('/v1/x')).rejects.toBeInstanceOf(ApiError);
    expect(await apiClient.get('/v1/x')).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('a change forgets every remembered read', () => {
  it('a save is followed by a fresh list', async () => {
    let bills = 1;
    const f = counted((url, method) => (method === 'POST' ? (bills++, json(200, { success: true })) : json(200, { count: bills })));
    expect((await apiClient.get('/v1/workspace/collections/bills')).count).toBe(1);
    await apiClient.post('/v1/workspace/collections/bills', { id: 'x' });
    expect((await apiClient.get('/v1/workspace/collections/bills')).count).toBe(2);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('every change counts, not only a POST, and a failed change too', async () => {
    const f = counted((url, method) => (method === 'DELETE' ? json(409, { error: { message: 'in use' } }) : json(200, {})));
    await apiClient.get('/v1/a');
    await expect(apiClient.delete('/v1/a/1')).rejects.toBeInstanceOf(ApiError);
    await apiClient.get('/v1/a');
    await apiClient.put('/v1/a', {});
    await apiClient.get('/v1/a');
    await apiClient.patch('/v1/a', {});
    await apiClient.get('/v1/a');
    expect(f.mock.calls.filter(([, i]) => (i?.method ?? 'GET') === 'GET')).toHaveLength(4);
  });

  it('an answer that was on its way when the change happened is not kept', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    let call = 0;
    const f = counted(async (url, method) => {
      if (method === 'GET') {
        call += 1;
        const mine = call;
        if (mine === 1) await gate; // the first read is slow and was asked for before the save
        return json(200, { read: mine });
      }
      return json(200, {});
    });
    const slow = apiClient.get('/v1/list');
    await apiClient.post('/v1/list', {});
    release();
    expect((await slow).read).toBe(1);
    expect((await apiClient.get('/v1/list')).read).toBe(2); // the stale answer was not stored
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('forgetReads() and a 401 both clear, and a 401 still signs the person out', async () => {
    const out = vi.fn();
    configureApiClient({ onUnauthorized: out });
    let status = 200;
    const f = counted(() => json(status, status === 200 ? { ok: 1 } : { error: { message: 'no' } }));
    await apiClient.get('/v1/me');
    forgetReads();
    await apiClient.get('/v1/me');
    expect(f).toHaveBeenCalledTimes(2);
    status = 401;
    await expect(apiClient.get('/v1/other')).rejects.toBeInstanceOf(ApiError);
    expect(out).toHaveBeenCalledTimes(1);
    status = 200;
    await apiClient.get('/v1/me'); // the earlier answer was dropped with the session
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe('what the shell uses to know when to look again', () => {
  it('dataVersion moves on a change and on forgetting, never on a read', async () => {
    counted(() => json(200, {}));
    const v0 = dataVersion();
    await apiClient.get('/v1/a');
    expect(dataVersion()).toBe(v0);
    await apiClient.post('/v1/a', {});
    expect(dataVersion()).toBeGreaterThan(v0);
    const v1 = dataVersion();
    forgetReads();
    expect(dataVersion()).toBeGreaterThan(v1);
  });

  it('an answer the app already has (the start-up call carries the businesses) is served without a call', async () => {
    const f = counted(() => json(200, { data: ['from the server'] }));
    rememberRead('/v1/businesses', { data: ['from start-up'] });
    expect((await apiClient.get('/v1/businesses')).data).toEqual(['from start-up']);
    expect(f).not.toHaveBeenCalled();
  });
});
