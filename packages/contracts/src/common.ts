import { z } from 'zod';

export const uuid = z.string().uuid();
/** YYYY-MM-DD, the way the app has always stored dates. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Not a valid GSTIN');
/** Empty string means "none": the forms submit '' for a blank GSTIN. */
export const optionalGstin = z.union([gstin, z.literal('')]).nullish();

/** Codes the API can answer with in `error.code`. */
export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'duplicate_number',
  'credit_dependency',
  'already_cancelled',
  'not_in_trash',
  'unprocessable',
  'too_many_requests',
  'internal',
] as const;
export const errorBody = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBody>;

/** Cursor pagination: `limit` rows, `cursor` is the opaque `nextCursor` of the previous page. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;

export const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });

/**
 * A PATCH body: every field optional and, unlike zod's .partial(), WITHOUT its default. With .partial() a field that is
 * left out comes back as its default (isDefault false, address '', ...) and the update would overwrite saved data.
 */
export function patchOf<T extends z.ZodObject>(schema: T) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [
      k,
      ((v instanceof z.ZodDefault ? v.unwrap() : v) as z.ZodType).optional(),
    ]),
  );
  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof T['shape']]: z.ZodOptional<T['shape'][K]>;
  }>;
}

export const idParam = z.object({ id: uuid });
export const okBody = z.object({ ok: z.literal(true) });

const stamps = { createdAt: z.string(), updatedAt: z.string() };
export const withStamps = stamps;
