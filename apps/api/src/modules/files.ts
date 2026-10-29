import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { schema } from '@ledgora/db';
import {
  downloadUrl,
  fileRecord,
  idParam,
  okBody,
  uploadUrl,
  uploadUrlInput,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import type { Hono } from 'hono';
import type { Deps } from '../http.ts';

const { files, businesses } = schema;
const LOGO_KINDS: Record<string, 'logoFileId' | 'signatureFileId' | 'stampFileId'> = {
  logo: 'logoFileId',
  signature: 'signatureFileId',
  stamp: 'stampFileId',
};
const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').slice(0, 120);

const out = (f: typeof files.$inferSelect) => ({
  id: f.id,
  kind: f.kind as z.infer<typeof fileRecord>['kind'],
  fileName: f.fileName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  status: f.status as 'pending' | 'ready',
  createdAt: f.createdAt.toISOString(),
});

export function filesModule({ route }: Registrar) {
  route({
    method: 'post',
    path: '/v1/files/upload-url',
    tag: 'Files',
    summary: 'Get a signed URL to upload a logo, signature, stamp, PDF or attachment',
    body: uploadUrlInput,
    response: uploadUrl,
    status: 201,
    handler: async ({ tx, orgId, body, deps }) => {
      const id = randomUUID();
      const key = `${orgId}/${body.kind}/${id}-${safeName(body.fileName)}`;
      await tx.insert(files).values({
        id,
        orgId,
        kind: body.kind,
        storageKey: key,
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        ownerType: body.ownerType ?? null,
        ownerId: body.ownerId ?? null,
      });
      const signed = await deps.storage.signUpload(key, body.contentType);
      return { fileId: id, uploadUrl: signed.url, method: 'PUT' as const, headers: signed.headers };
    },
  });

  route({
    method: 'post',
    path: '/v1/files/:id/complete',
    tag: 'Files',
    summary:
      'Tell the API the upload finished; it checks the object exists and, for a logo/signature/stamp, attaches it to the business',
    params: idParam,
    response: fileRecord,
    handler: async ({ tx, orgId, params, deps }) => {
      const [f] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, params.id), isNull(files.deletedAt)));
      if (!f) throw notFound('File');
      const size = await deps.storage.size(f.storageKey);
      if (size === null) throw new AppError('unprocessable', 'No upload found for this file yet');
      const [row] = await tx
        .update(files)
        .set({ status: 'ready', sizeBytes: size, updatedAt: new Date() })
        .where(eq(files.id, f.id))
        .returning();
      const column = LOGO_KINDS[f.kind];
      if (column && f.ownerType === 'business' && f.ownerId) {
        await tx
          .update(businesses)
          .set({ [column]: f.id, updatedAt: new Date() })
          .where(eq(businesses.id, f.ownerId));
      }
      await audit(tx, orgId, 'file.upload', 'file', f.id, { after: { kind: f.kind, size } });
      return out(row);
    },
  });

  route({
    method: 'get',
    path: '/v1/files/:id',
    tag: 'Files',
    summary: 'File details',
    params: idParam,
    response: fileRecord,
    handler: async ({ tx, params }) => {
      const [f] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, params.id), isNull(files.deletedAt)));
      if (!f) throw notFound('File');
      return out(f);
    },
  });

  route({
    method: 'get',
    path: '/v1/files/:id/download-url',
    tag: 'Files',
    summary: 'A short-lived signed URL to download the file',
    params: idParam,
    response: downloadUrl,
    handler: async ({ tx, params, deps }) => {
      const [f] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, params.id), isNull(files.deletedAt)));
      if (!f || f.status !== 'ready') throw notFound('File');
      return {
        url: await deps.storage.signDownload(f.storageKey, f.fileName, 300),
        expiresInSeconds: 300,
      };
    },
  });

  route({
    method: 'delete',
    path: '/v1/files/:id',
    tag: 'Files',
    summary: 'Delete a file and its stored object',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params, deps }) => {
      const [f] = await tx
        .update(files)
        .set({ deletedAt: new Date() })
        .where(and(eq(files.id, params.id), isNull(files.deletedAt)))
        .returning();
      if (!f) throw notFound('File');
      await deps.storage.remove(f.storageKey);
      await audit(tx, orgId, 'file.delete', 'file', f.id);
      return { ok: true };
    },
  });
}

/**
 * The local disk driver's upload and download endpoint. It is reached by a signed URL, so it needs no login header:
 * the signature names the object and an expiry. With S3 configured these URLs point at S3 instead and this never runs.
 */
export function localFileEndpoints(app: Hono, { storage }: Deps) {
  app.put('/v1/storage/local', async (c) => {
    const key = c.req.query('key') ?? '';
    if (
      storage.driver !== 'local' ||
      !storage.verify(key, 'put', Number(c.req.query('exp')), c.req.query('sig') ?? '')
    ) {
      throw new AppError('forbidden', 'This upload link is not valid or has expired');
    }
    await storage.put(key, new Uint8Array(await c.req.arrayBuffer()));
    return c.body(null, 200);
  });
  app.get('/v1/storage/local', async (c) => {
    const key = c.req.query('key') ?? '';
    if (
      storage.driver !== 'local' ||
      !storage.verify(key, 'get', Number(c.req.query('exp')), c.req.query('sig') ?? '')
    ) {
      throw new AppError('forbidden', 'This download link is not valid or has expired');
    }
    const bytes = await storage.get(key);
    if (!bytes) throw notFound('File');
    const name = (c.req.query('name') ?? 'download').replace(/"/g, '');
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${name}"`,
    });
  });
}
