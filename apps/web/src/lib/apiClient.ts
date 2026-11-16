import { toast } from '../components/ui/Toast';

/**
 * The one way the app talks to the account API (change 3.3). Cookies carry the session, so there is no token to store.
 * Three answers get the same treatment everywhere, so no screen has to remember them:
 *   401  the session ended: back to the sign-in screen
 *   402  the plan does not include this: the Upgrade sheet opens
 *   403  the role may not do this: a toast says so
 */

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(message: string, status = 0, code = '', details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiHandlers {
  onUnauthorized: () => void;
  onUpgrade: (info: { message: string; feature?: string; locked?: boolean }) => void;
  onForbidden: (message: string) => void;
}

const handlers: ApiHandlers = {
  onUnauthorized: () => {},
  onUpgrade: () => {},
  onForbidden: (message) => toast(message, 'error'),
};

/** The shell registers what to do on 401 and 402 once it exists; tests register their own. */
export function configureApiClient(next: Partial<ApiHandlers>) {
  Object.assign(handlers, next);
}

type Query = Record<string, string | number | boolean | undefined | null>;
export interface RequestOptions {
  query?: Query;
  /** Skip the remembered answer and ask the server again (a "Refresh" button). */
  fresh?: boolean;
  /** Handle 403 yourself (for example to show a disabled state) instead of the shared toast. */
  quietForbidden?: boolean;
  signal?: AbortSignal;
}

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

// Reads are remembered for a few seconds and shared while they are in flight. Half the screens ask for the same lists
// (the businesses, the settings, the bills) and a screen that re-mounts asks again; before this, one page load made about
// forty calls, which on a slow host queued behind the browser's six connections. Every change (any call that is not a GET)
// forgets everything, so a screen that saves is never shown the list as it was.
const READ_TTL_MS = 10_000;
const READ_MAX = 300;
const reading = new Map<string, Promise<unknown>>();
const recent = new Map<string, { at: number; value: unknown }>();
let generation = 0;
const copy = <T,>(v: T): T => (v !== null && typeof v === 'object' ? structuredClone(v) : v);

/** Forget every remembered read: anything that changes data may change what a list shows, and so does signing out. */
export function forgetReads() {
  generation += 1;
  reading.clear();
  recent.clear();
}

/** Changes every time data may have changed (any save, or signing out): "has anything happened since I last looked?". */
export const dataVersion = () => generation;

/** Keep an answer the app already has (the start-up call returns the businesses) so the screens that ask for it do not. */
export function rememberRead(path: string, value: unknown) {
  recent.set(path, { at: Date.now(), value: copy(value) });
}

async function send<T>(method: string, path: string, body: unknown, opts: RequestOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withQuery(path, opts.query), {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Cannot reach the Ledgora server. Check your connection and try again.', 0, 'network');
  }
  const text = await res.text();
  let json: { error?: { code?: string; message?: string; details?: unknown }; message?: string; code?: string } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: an error page from a proxy */
  }
  if (res.ok) return json as T;

  const code = json?.error?.code ?? json?.code ?? '';
  const message =
    json?.error?.message ?? json?.message ?? (res.status >= 500 ? 'Cannot reach the Ledgora server. Try again in a moment.' : `Request failed (${res.status})`);
  if (res.status === 401) {
    forgetReads();
    handlers.onUnauthorized();
  } else if (res.status === 402) handlers.onUpgrade({ message, ...(json?.error?.details as { feature?: string; locked?: boolean } | undefined) });
  else if (res.status === 403 && !opts.quietForbidden) handlers.onForbidden(message);
  throw new ApiError(message, res.status, code, json?.error?.details ?? null);
}

export async function request<T = unknown>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  if (method !== 'GET') {
    // The change may land, and an answer already on its way may predate it: forget both before and after.
    forgetReads();
    try {
      return await send<T>(method, path, body, opts);
    } finally {
      forgetReads();
    }
  }
  // A caller that can cancel (a type-ahead search) or wants it fresh asks the server itself.
  if (opts.signal || opts.fresh) return send<T>(method, path, body, opts);
  const key = withQuery(path, opts.query);
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return copy(hit.value) as T;
  const going = reading.get(key);
  if (going) return (going as Promise<T>).then(copy);
  const started = generation;
  const p = send<T>(method, path, body, opts)
    .then((value) => {
      // Not kept when something changed meanwhile: that answer may be from before the change.
      if (started === generation) {
        if (recent.size >= READ_MAX) recent.delete(recent.keys().next().value as string);
        recent.set(key, { at: Date.now(), value });
      }
      return value;
    })
    .finally(() => {
      if (reading.get(key) === p) reading.delete(key);
    });
  reading.set(key, p);
  return p.then(copy);
}

export const apiClient = {
  get: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  put: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body ?? {}, opts),
  patch: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  delete: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};
