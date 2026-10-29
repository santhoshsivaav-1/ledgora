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
  onUpgrade: (info: { message: string; feature?: string }) => void;
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

export async function request<T = unknown>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
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
  if (res.status === 401) handlers.onUnauthorized();
  else if (res.status === 402) handlers.onUpgrade({ message, feature: (json?.error?.details as { feature?: string } | undefined)?.feature });
  else if (res.status === 403 && !opts.quietForbidden) handlers.onForbidden(message);
  throw new ApiError(message, res.status, code, json?.error?.details ?? null);
}

export const apiClient = {
  get: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  put: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body ?? {}, opts),
  patch: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  delete: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};
