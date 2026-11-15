import { describe, expect, it } from 'vitest';
import { uploadUrlInput } from '@ledgora/contracts';
import { loadEnv } from '../src/env.ts';

const base = { NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@db.example.com:5432/x' };

describe('environment guard', () => {
  it('refuses the public dev secrets when the database is not local, even without NODE_ENV=production', () => {
    expect(() => loadEnv(base)).toThrow(/AUTH_SECRET must be set/);
    expect(() => loadEnv({ ...base, AUTH_SECRET: 'x'.repeat(40) })).toThrow(
      /FILE_SIGNING_SECRET must be set/,
    );
  });
  it('still lets a local developer boot with the defaults', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@localhost:5432/x' }),
    ).not.toThrow();
  });
});

describe('upload rules', () => {
  const ok = { kind: 'attachment', fileName: 'a', contentType: 'application/pdf', sizeBytes: 5 };
  it('accepts normal files and rejects active content', () => {
    expect(uploadUrlInput.safeParse(ok).success).toBe(true);
    for (const t of ['text/html', 'image/svg+xml', 'application/javascript'])
      expect(uploadUrlInput.safeParse({ ...ok, contentType: t }).success).toBe(false);
  });
  it('requires a raster image for a logo and a PDF for an invoice file', () => {
    expect(
      uploadUrlInput.safeParse({ ...ok, kind: 'logo', contentType: 'image/png' }).success,
    ).toBe(true);
    expect(
      uploadUrlInput.safeParse({ ...ok, kind: 'logo', contentType: 'application/pdf' }).success,
    ).toBe(false);
    expect(
      uploadUrlInput.safeParse({ ...ok, kind: 'invoice_pdf', contentType: 'image/png' }).success,
    ).toBe(false);
  });
});
