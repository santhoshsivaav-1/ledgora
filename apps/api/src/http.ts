import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { sql, and, isNull, lt, or, ilike, desc, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { withTenant, type Database, type Tx } from '@ledgora/db';
import type { AppEnv } from './env.ts';
import { AppError, validationError } from './errors.ts';
import type { Storage } from './storage.ts';
import type { Auth } from './auth/auth.ts';
import {
  requireFeature,
  requireOrg,
  requirePermission,
  requireSession,
  type OrgContext,
} from './middleware/index.ts';
import type { Permission } from '@ledgora/contracts';

/** What every module gets: the pool, the settings and file storage. */
export interface Deps {
  db: Database;
  env: AppEnv;
  storage: Storage;
  auth: Auth;
}

export interface RouteSpec<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType,
> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string; // Hono style: /v1/parties/:id
  tag: string;
  summary: string;
  params?: P;
  query?: Q;
  body?: B;
  response?: R;
  /** 201 for creates, 202 for background jobs. Default 200. */
  status?: 200 | 201 | 202;
  /**
   * Who may call. 'org' (default) runs the whole chain: session, organization, permission, feature, and the handler
   * gets a tenant transaction. 'session' needs only a signed-in user (account pages, accepting an invitation) and gets
   * an owner transaction for the auth tables. 'public' needs nothing (health).
   */
  access?: 'org' | 'session' | 'public';
  /** Overrides the permission the path would imply (null = any member). */
  permission?: Permission | null;
  /** Plan feature the route belongs to; checked by requireFeature once billing exists (change 4.4). */
  feature?: string;
  handler: (a: {
    tx: Tx;
    orgId: string;
    auth: OrgContext;
    params: z.infer<P>;
    query: z.infer<Q>;
    body: z.infer<B>;
    c: Context;
    deps: Deps;
  }) => Promise<unknown>;
}

export interface DocumentedRoute {
  method: string;
  path: string;
  tag: string;
  summary: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response?: z.ZodType;
  status: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registers routes on a Hono app and remembers them so /v1/openapi.json can describe them. */
export function createRegistrar(app: Hono, deps: Deps) {
  const documented: DocumentedRoute[] = [];

  function route<
    P extends z.ZodType = z.ZodType<undefined>,
    Q extends z.ZodType = z.ZodType<undefined>,
    B extends z.ZodType = z.ZodType<undefined>,
    R extends z.ZodType = z.ZodType<unknown>,
  >(spec: RouteSpec<P, Q, B, R>) {
    documented.push({
      method: spec.method,
      path: spec.path,
      tag: spec.tag,
      summary: spec.summary,
      params: spec.params,
      query: spec.query,
      body: spec.body,
      response: spec.response,
      status: spec.status ?? 200,
    });
    app[spec.method](spec.path, async (c) => {
      const params = spec.params
        ? spec.params.safeParse(c.req.param())
        : { success: true as const, data: undefined };
      if (!params.success) throw validationError(params.error);
      const query = spec.query
        ? spec.query.safeParse(c.req.query())
        : { success: true as const, data: undefined };
      if (!query.success) throw validationError(query.error);
      let body: unknown = undefined;
      if (spec.body) {
        const raw = await c.req.json().catch(() => {
          throw new AppError('bad_request', 'The request body must be JSON');
        });
        const parsed = spec.body.safeParse(raw);
        if (!parsed.success) throw validationError(parsed.error);
        body = parsed.data;
      }
      const run = async (tx: Tx, auth: OrgContext) =>
        spec.handler({
          tx,
          orgId: auth.orgId,
          auth,
          params: params.data as z.infer<P>,
          query: query.data as z.infer<Q>,
          body: body as z.infer<B>,
          c,
          deps,
        });
      let result: unknown;
      const access = spec.access ?? 'org';
      if (access === 'public') {
        result = await deps.db.transaction((tx) => run(tx, { orgId: '' } as unknown as OrgContext));
      } else {
        const session = await requireSession(c, deps.auth, deps.env);
        if (access === 'session') {
          result = await deps.db.transaction((tx) =>
            run(tx, { ...session, orgId: '' } as unknown as OrgContext),
          );
        } else {
          const ctx = await requireOrg(c, deps.db, session);
          requirePermission(ctx, spec.method, spec.path, spec.permission);
          await requireFeature(ctx, spec.feature);
          result = await withTenant(deps.db, ctx.orgId, (tx) => run(tx, ctx), {
            businessIds: ctx.businessIds,
            actorId: ctx.user.id,
            ip: ctx.ip,
          });
        }
      }
      if (result instanceof Response) return result;
      return c.json((result ?? { ok: true }) as object, (spec.status ?? 200) as 200);
    });
  }

  return { route, documented };
}
export type Registrar = ReturnType<typeof createRegistrar>;

// ---- cursor pagination (change 1.26) -------------------------------------------------------------------------------

/** Microsecond-exact text form of created_at: a JS Date would round it and a cursor could skip or repeat rows. */
export const tsText = (col: PgColumn) =>
  sql<string>`to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const encode = (t: string, id: string) =>
  Buffer.from(JSON.stringify([t, id])).toString('base64url');
function decode(cursor: string): [string, string] {
  try {
    const [t, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      typeof t === 'string' &&
      typeof id === 'string' &&
      UUID.test(id) &&
      !Number.isNaN(Date.parse(t))
    )
      return [t, id];
  } catch {
    /* fall through */
  }
  throw new AppError('bad_request', 'cursor is not valid');
}

type Paged = PgTable & { id: PgColumn; orgId: PgColumn; createdAt: PgColumn; deletedAt: PgColumn };

/** Newest first, `limit` rows, stable under inserts: keyset on (created_at, id). */
export async function listPage<T extends Paged>(
  tx: Tx,
  table: T,
  opts: { limit: number; cursor?: string; q?: string; searchColumns?: PgColumn[]; where?: SQL },
) {
  const conds: (SQL | undefined)[] = [isNull(table.deletedAt), opts.where];
  if (opts.q && opts.searchColumns?.length) {
    const like = `%${opts.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(...opts.searchColumns.map((col) => ilike(col, like))));
  }
  if (opts.cursor) {
    const [t, id] = decode(opts.cursor);
    conds.push(
      or(
        lt(table.createdAt, sql`${t}::timestamptz`),
        and(eq(table.createdAt, sql`${t}::timestamptz`), lt(table.id, id as never)),
      ),
    );
  }
  const rows = (await tx
    .select({ row: table, ts: tsText(table.createdAt) })
    .from(table as PgTable)
    .where(and(...conds))
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(opts.limit + 1)) as unknown as { row: T['$inferSelect']; ts: string }[];
  const more = rows.length > opts.limit;
  const slice = more ? rows.slice(0, opts.limit) : rows;
  const last = slice.at(-1);
  return {
    data: slice.map((r) => r.row),
    nextCursor: more && last ? encode(last.ts, (last.row as { id: string }).id) : null,
  };
}

export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export const stamps = (r: { createdAt: Date; updatedAt: Date }) => ({
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
