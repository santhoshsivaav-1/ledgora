import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewFromPath, pathForView, legacyViewRedirect, VIEW_ROUTES } from '../src/app/router';
import { roleCan } from '../src/lib/permissions';
import { ApiError, apiClient, configureApiClient } from '../src/lib/apiClient';
import { createQueryClient } from '../src/lib/queryClient';

const reply = (status, body) =>
  vi.fn(async () => new Response(body === undefined ? '' : JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe('routes (3.1)', () => {
  it('every screen has its own path and the path leads back to the screen', () => {
    for (const r of VIEW_ROUTES) {
      const concrete = r.path.replace(':id', 'abc');
      expect(viewFromPath(concrete)).toBe(r.id);
    }
    expect(new Set(VIEW_ROUTES.map((r) => r.path)).size).toBe(VIEW_ROUTES.length);
  });
  it('ignores a trailing slash, and an unknown path opens the dashboard', () => {
    expect(viewFromPath('/clients/')).toBe('clients');
    expect(viewFromPath('/settings/team')).toBe('team'); // not swallowed by /settings
    expect(viewFromPath('/nope')).toBe('dashboard');
    expect(pathForView('filing')).toBe('/gst-returns');
    expect(pathForView('unknown')).toBe('/');
  });
  it('maps the old ?view= shortcuts, only on the home path', () => {
    expect(legacyViewRedirect('/', '?view=new')).toBe('/invoices/new');
    expect(legacyViewRedirect('/', '?view=bogus')).toBeNull();
    expect(legacyViewRedirect('/clients', '?view=new')).toBeNull();
  });
});

describe('permissions (3.22)', () => {
  it('follows the same table as the API', () => {
    expect(roleCan('owner', 'billing:manage')).toBe(true);
    expect(roleCan('admin', 'billing:manage')).toBe(false);
    expect(roleCan('viewer', 'invoice:write')).toBe(false);
    expect(roleCan('viewer', 'invoice:read')).toBe(true);
    expect(roleCan('salesman', 'team:read')).toBe(false);
    expect(roleCan(undefined, 'invoice:read')).toBe(false);
    expect(roleCan('not-a-role', 'invoice:read')).toBe(false);
  });
});

describe('apiClient (3.3)', () => {
  const handlers = { onUnauthorized: vi.fn(), onUpgrade: vi.fn(), onForbidden: vi.fn() };
  const setup = () => {
    Object.values(handlers).forEach((h) => h.mockClear());
    configureApiClient(handlers);
  };

  it('returns the JSON on success and sends cookies, JSON bodies and query strings', async () => {
    setup();
    const f = reply(200, { data: [1] });
    vi.stubGlobal('fetch', f);
    expect(
      await apiClient.get('/v1/parties', {
        query: { q: 'acme', limit: 5, empty: '', none: undefined },
      }),
    ).toEqual({ data: [1] });
    expect(f.mock.calls[0][0]).toBe('/v1/parties?q=acme&limit=5');
    expect(f.mock.calls[0][1].credentials).toBe('same-origin');
    vi.stubGlobal('fetch', reply(201, { id: 'x' }));
    await apiClient.post('/v1/parties', { name: 'A' });
  });

  it('401 -> sign-in, 402 -> upgrade sheet, 403 -> shared message; each still throws an ApiError', async () => {
    setup();
    vi.stubGlobal(
      'fetch',
      reply(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
    );
    await expect(apiClient.get('/v1/me')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(handlers.onUnauthorized).toHaveBeenCalledTimes(1);

    vi.stubGlobal(
      'fetch',
      reply(402, {
        error: { code: 'payment_required', message: 'Needs Pro', details: { feature: 'gstr' } },
      }),
    );
    await expect(apiClient.get('/v1/x')).rejects.toBeInstanceOf(ApiError);
    expect(handlers.onUpgrade).toHaveBeenCalledWith({ message: 'Needs Pro', feature: 'gstr' });

    vi.stubGlobal(
      'fetch',
      reply(403, { error: { code: 'forbidden', message: 'Your role (viewer) can not do this' } }),
    );
    await expect(apiClient.post('/v1/parties', { name: 'x' })).rejects.toMatchObject({
      status: 403,
    });
    expect(handlers.onForbidden).toHaveBeenCalledWith('Your role (viewer) can not do this');
  });

  it('a screen can handle 403 itself; Better Auth style errors read too; network failures are named', async () => {
    setup();
    vi.stubGlobal('fetch', reply(403, { error: { message: 'no' } }));
    await expect(apiClient.get('/v1/x', { quietForbidden: true })).rejects.toBeInstanceOf(ApiError);
    expect(handlers.onForbidden).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', reply(400, { message: 'Invalid OTP', code: 'INVALID_OTP' }));
    await expect(apiClient.get('/v1/x')).rejects.toMatchObject({
      message: 'Invalid OTP',
      code: 'INVALID_OTP',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('failed to fetch');
      }),
    );
    await expect(apiClient.get('/v1/x')).rejects.toMatchObject({ code: 'network' });
  });
});

describe('queryClient (3.3)', () => {
  it('does not retry a 4xx answer but retries a server hiccup twice', () => {
    const retry = createQueryClient().getDefaultOptions().queries.retry;
    expect(retry(0, new ApiError('no', 403))).toBe(false);
    expect(retry(0, new ApiError('nope', 404))).toBe(false);
    expect(retry(0, new ApiError('boom', 500))).toBe(true);
    expect(retry(1, new ApiError('boom', 500))).toBe(true);
    expect(retry(2, new ApiError('boom', 500))).toBe(false);
  });
});
