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

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const RASTER_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Types a browser would run or render as a page: never stored, whatever the file is called. */
const ACTIVE_CONTENT =
  /^(text\/html|application\/xhtml|image\/svg|text\/javascript|application\/(x-)?javascript|application\/x-(sh|msdownload|msdos-program)|text\/xml|application\/xml)/i;

export const uploadUrlInput = z
  .object({
    kind: z.enum(FILE_KINDS),
    fileName: z.string().trim().min(1).max(200),
    contentType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
    sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    ownerType: z.enum(['business', 'invoice', 'purchase', 'expense']).nullish(),
    ownerId: uuid.nullish(),
  })
  .superRefine((v, ctx) => {
    const type = v.contentType.toLowerCase();
    const bad = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['contentType'], message });
    if (['logo', 'signature', 'stamp'].includes(v.kind) && !RASTER_IMAGES.includes(type))
      bad('A logo, signature or stamp must be a PNG, JPEG, WebP or GIF image');
    else if (v.kind === 'invoice_pdf' && type !== 'application/pdf')
      bad('An invoice file must be a PDF');
    else if (ACTIVE_CONTENT.test(type)) bad('This kind of file can not be uploaded');
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
