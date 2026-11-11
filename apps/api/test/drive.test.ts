import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  openText,
  readState,
  sealText,
  serverBackupPassword,
  signState,
} from '../src/backup/keys.ts';
import { authUrl, driveAvailable } from '../src/backup/drive.ts';
import { makeHarness } from './helpers.ts';

// Vyapar parity P7-S4: saving backups to Google Drive, the server-held keys, and encrypted scheduled backups. Google
// is stood in for by a stubbed fetch: the flow is exercised end to end here, but never against Google itself.
const h = makeHarness({
  env: {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    APP_URL: 'http://localhost:5173',
  },
});
afterAll(() => h.close());
afterEach(() => vi.unstubAllGlobals());

const env = { AUTH_SECRET: 'x'.repeat(32) };

describe('keys the server holds', () => {
  it('the scheduled-backup password is stable per organization and differs between organizations and secrets', () => {
    expect(serverBackupPassword(env, 'org-1')).toBe(serverBackupPassword(env, 'org-1'));
    expect(serverBackupPassword(env, 'org-1')).not.toBe(serverBackupPassword(env, 'org-2'));
    expect(serverBackupPassword(env, 'org-1')).not.toBe(
      serverBackupPassword({ AUTH_SECRET: 'y'.repeat(32) }, 'org-1'),
    );
    // BACKUP_ENCRYPTION_KEY rotates it without touching sign-in
    expect(
      serverBackupPassword({ ...env, BACKUP_ENCRYPTION_KEY: 'k'.repeat(20) }, 'org-1'),
    ).not.toBe(serverBackupPassword(env, 'org-1'));
  });
  it('a sealed refresh token opens with the same secret and not another', () => {
    const sealed = sealText(env, '1//refresh-token');
    expect(sealed).not.toContain('refresh');
    expect(openText(env, sealed)).toBe('1//refresh-token');
    expect(() => openText({ AUTH_SECRET: 'y'.repeat(32) }, sealed)).toThrow();
    expect(sealText(env, 'a')).not.toBe(sealText(env, 'a')); // random IV
  });
  it('the OAuth state is signed and expires', () => {
    const st = signState(env, { orgId: 'o', userId: 'u' }, 60_000, 1_000);
    expect(readState(env, st, 2_000)).toMatchObject({ orgId: 'o', userId: 'u' });
    expect(readState(env, st, 62_000)).toBeNull(); // expired
    expect(readState(env, `${st.slice(0, -2)}xx`, 2_000)).toBeNull(); // altered signature
    expect(
      readState(
        env,
        `${Buffer.from('{"orgId":"evil","exp":99999999999999}').toString('base64url')}.${st.split('.')[1]}`,
        2_000,
      ),
    ).toBeNull();
    expect(readState({ AUTH_SECRET: 'y'.repeat(32) }, st, 2_000)).toBeNull();
    expect(readState(env, 'nonsense')).toBeNull();
  });
  it('the Google URL asks for the narrow scope, offline access and our callback', () => {
    const u = new URL(
      authUrl(
        {
          GOOGLE_CLIENT_ID: 'cid',
          API_URL: 'https://api.example.com/',
          APP_URL: 'https://app.example.com',
        },
        'st',
      ),
    );
    expect(u.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('scope')).not.toContain('auth/drive ');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/v1/backups/drive/callback',
    );
    expect(u.searchParams.get('state')).toBe('st');
    expect(driveAvailable({ GOOGLE_CLIENT_ID: 'a' })).toBe(false);
  });
});

/** A stand-in for Google's token endpoint and the Drive API. Records every call. */
function fakeGoogle(opts: { uploadStatus?: number } = {}) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  let n = 0;
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body
      ? typeof init.body === 'string'
        ? init.body
        : init.body instanceof URLSearchParams
          ? init.body.toString()
          : Buffer.from(init.body as Buffer).toString('latin1')
      : undefined;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body,
      auth: (init?.headers as Record<string, string> | undefined)?.authorization,
    });
    const j = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (String(body).includes('grant_type=authorization_code'))
        return j({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          id_token: `x.${Buffer.from(JSON.stringify({ email: 'owner@gmail.com' })).toString('base64url')}.y`,
        });
      return j({ access_token: `at-${++n + 1}` });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return j({});
    if (url.includes('/upload/drive/v3/files'))
      return opts.uploadStatus && opts.uploadStatus !== 200
        ? j({ error: { message: 'Quota exceeded' } }, opts.uploadStatus)
        : j({ id: `drive-file-${calls.length}` });
    if (url.match(/\/drive\/v3\/files\/[^?]+\?fields/))
      return j({ id: 'folder-1', trashed: false });
    if (url.includes('/drive/v3/files') && init?.method === 'POST') return j({ id: 'folder-1' });
    if (url.includes('/drive/v3/files/') && init?.method === 'DELETE')
      return new Response(null, { status: 204 });
    return j({ error: 'unexpected' }, 404);
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

describe('Google Drive', () => {
  it('connect, back up to Drive (in a Ledgora folder), prune and disconnect', async () => {
    const calls = fakeGoogle();
    const t = await h.newTenant();
    const before = (await t.call('GET', '/v1/backups')).body.drive;
    expect(before).toMatchObject({ available: true, connected: false });
    const c = await t.call('GET', '/v1/backups/drive/connect');
    expect(c.status, c.text).toBe(200);
    const url = new URL(c.body.url);
    expect(url.searchParams.get('client_id')).toBe('client-id');
    const state = url.searchParams.get('state')!;
    // Google redirects the browser back with a code (no cookie needed: the signed state says who started it)
    const cb = await h.app.request(
      `/v1/backups/drive/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe(
      'http://localhost:5173/utilities/backup?drive=connected',
    );
    expect(
      calls.some(
        (x) =>
          x.url.startsWith('https://oauth2.googleapis.com/token') &&
          /code=abc/.test(x.body ?? '') &&
          /client_secret=client-secret/.test(x.body ?? ''),
      ),
    ).toBe(true);
    expect((await t.call('GET', '/v1/backups')).body.drive).toMatchObject({
      connected: true,
      email: 'owner@gmail.com',
    });
    // the refresh token is stored encrypted
    const { withTenant, schema } = await import('@ledgora/db');
    const stored = await withTenant(h.db, t.orgId, (tx) => tx.select().from(schema.backupDrive));
    expect(stored).toHaveLength(1);
    expect(stored[0].refreshTokenEnc).not.toContain('rt-1');

    const b = await t.call('POST', '/v1/backups', { password: 'a long password' });
    expect(b.status, b.text).toBe(201);
    expect(b.body).toMatchObject({ onDrive: true, keyMode: 'password' });
    expect(b.body.driveError).toBeNull();
    const up = calls.find((x) => x.url.includes('/upload/drive/v3/files'))!;
    expect(up.auth).toMatch(/^Bearer at-/);
    expect(up.body).toContain('"name":"ledgora-manual-');
    expect(up.body).toContain('"parents":["folder-1"]');
    expect(up.body).toContain('LDGENC1'); // what reaches Google is the encrypted file
    expect(up.body).not.toContain('Utility'); // not readable
    expect(
      calls.some((x) => x.method === 'POST' && x.url.includes('/drive/v3/files?fields=id')),
    ).toBe(true); // the folder was made

    // deleting the backup removes the Drive copy too
    expect((await t.call('DELETE', `/v1/backups/${b.body.id}`)).status).toBe(200);
    expect(calls.some((x) => x.method === 'DELETE' && /files\/drive-file-/.test(x.url))).toBe(true);

    // a backup without the Drive switch stays local
    const local = await t.call('POST', '/v1/backups', { toDrive: false });
    expect(local.body.onDrive).toBe(false);

    expect((await t.call('DELETE', '/v1/backups/drive/connection')).status).toBe(200);
    expect(calls.some((x) => x.url.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true);
    expect((await t.call('GET', '/v1/backups')).body.drive.connected).toBe(false);
    expect(
      await withTenant(h.db, t.orgId, (tx) => tx.select().from(schema.backupDrive)),
    ).toHaveLength(0);
  });

  it('a forged, expired or denied callback connects nothing', async () => {
    fakeGoogle();
    const t = await h.newTenant();
    const state = new URL(
      (await t.call('GET', '/v1/backups/drive/connect')).body.url,
    ).searchParams.get('state')!;
    const go = async (q: string) =>
      (await h.app.request(`/v1/backups/drive/callback?${q}`)).headers.get('location');
    expect(await go(`code=abc&state=${encodeURIComponent(`${state}x`)}`)).toMatch(/drive=denied/);
    expect(await go('code=abc')).toMatch(/drive=denied/);
    expect(await go(`error=access_denied&state=${encodeURIComponent(state)}`)).toMatch(
      /drive=denied/,
    );
    expect((await t.call('GET', '/v1/backups')).body.drive.connected).toBe(false);
  });

  it('a Drive failure does not fail the backup and is shown', async () => {
    const calls = fakeGoogle();
    const t = await h.newTenant();
    const state = new URL(
      (await t.call('GET', '/v1/backups/drive/connect')).body.url,
    ).searchParams.get('state')!;
    await h.app.request(`/v1/backups/drive/callback?code=abc&state=${encodeURIComponent(state)}`);
    calls.length = 0;
    fakeGoogle({ uploadStatus: 403 });
    const b = await t.call('POST', '/v1/backups', {});
    expect(b.status).toBe(201);
    expect(b.body.onDrive).toBe(false);
    expect(b.body.driveError).toMatch(/Quota exceeded/);
    expect((await t.call('GET', '/v1/backups')).body.drive.lastError).toMatch(/Quota exceeded/);
    expect((await t.call('GET', '/v1/backups')).body.data).toHaveLength(1);
  });

  it('connect says so when the server has no Google client; only people who manage settings may connect', async () => {
    const plain = makeHarness();
    const t = await plain.newTenant();
    expect((await t.call('GET', '/v1/backups')).body.drive.available).toBe(false);
    const r = await t.call('GET', '/v1/backups/drive/connect');
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/GOOGLE_CLIENT_ID/);
    await plain.close();
    const t2 = await h.newTenant();
    const viewer = await h.addMember(t2, 'viewer');
    expect((await viewer.call('GET', '/v1/backups/drive/connect')).status).toBe(403);
    expect((await viewer.call('DELETE', '/v1/backups/drive/connection')).status).toBe(403);
  });
});

describe('scheduled backups are encrypted with the server key', () => {
  it('is encrypted, opens from the history without a password, and not from a downloaded file', async () => {
    const t = await h.newTenant();
    await t.call('POST', '/v1/parties', { name: 'Secret Customer Pvt Ltd' });
    await t.call('PUT', '/v1/backups/settings', {
      frequency: 'daily',
      hour: 0,
      keepLast: 3,
      remind: true,
      remindDays: 7,
    });
    expect((await t.call('POST', '/v1/backups/run-due')).body.taken).toBe(true);
    const auto = (await t.call('GET', '/v1/backups')).body.data.find((b: any) => b.kind === 'auto');
    expect(auto).toMatchObject({ encrypted: true, keyMode: 'server' });
    const file = await h.app.request(`/v1/backups/${auto.id}/download`, {
      headers: { cookie: t.cookie },
    });
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.subarray(0, 7).toString()).toBe('LDGENC1');
    expect(bytes.includes(Buffer.from('Secret Customer'))).toBe(false);
    // from the history the server opens it itself
    const preview = await t.call('POST', '/v1/backups/restore', { backupId: auto.id });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.counts.parties).toBe(1);
    // as a bare file it asks for a password nobody has
    const raw = await t.call('POST', '/v1/backups/restore', { file: bytes.toString('base64') });
    expect(raw.status).toBe(422);
    expect(raw.body.error.details.reason).toBe('needs_password');
    // a manual backup the owner leaves unencrypted stays plain
    const plain = await t.call('POST', '/v1/backups', {});
    expect(plain.body).toMatchObject({ encrypted: false, keyMode: 'none' });
  });
});
