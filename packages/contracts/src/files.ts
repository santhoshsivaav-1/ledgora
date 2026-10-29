import { z } from 'zod';
import { uuid } from './common.ts';

export const FILE_KINDS = [
  'logo',
  'signature',
  'stamp',
  'invoice_pdf',
  'attachment',
  'export',
] as const;

export const uploadUrlInput = z.object({
  kind: z.enum(FILE_KINDS),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
  ownerType: z.enum(['business', 'invoice', 'purchase', 'expense']).nullish(),
  ownerId: uuid.nullish(),
});
export const uploadUrl = z.object({
  fileId: uuid,
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
});
export const fileRecord = z.object({
  id: uuid,
  kind: z.enum(FILE_KINDS),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['pending', 'ready']),
  createdAt: z.string(),
});
export const downloadUrl = z.object({ url: z.string(), expiresInSeconds: z.number() });
