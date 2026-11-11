import { describe, expect, it } from 'vitest';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  type SnapshotError,
  buildSnapshot,
  readSnapshot,
  snapshotIsEncrypted,
} from '../src/backup/snapshot.ts';

// Vyapar parity P7-S4: the snapshot file. Round trip, encryption, and every way a file can be bad.
const data = {
  businesses: [{ id: 'b1', name: 'Shop' }],
  invoices: [
    { id: 'i1', total: 118.5, when: '2026-11-11T00:00:00.000Z' },
    { id: 'i2', total: 1 },
  ],
  parties: [],
};
const meta = {
  app: '1.10.80',
  schema: 17,
  orgName: 'Shop & Co',
  now: new Date('2026-11-11T10:00:00Z'),
};
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as SnapshotError).code;
  }
  return null;
};

describe('snapshot file', () => {
  it('round trip: counts, hashes and every row come back', () => {
    const { bytes, manifest } = buildSnapshot(data, meta);
    expect(manifest).toMatchObject({
      format: 1,
      schema: 17,
      businesses: 1,
      counts: { businesses: 1, invoices: 2, parties: 0 },
      encrypted: false,
    });
    expect(Object.keys(manifest.hashes).sort()).toEqual(['businesses', 'invoices', 'parties']);
    const back = readSnapshot(bytes, { currentSchema: 17 });
    expect(back.data).toEqual(data);
    expect(back.manifest.createdAt).toBe('2026-11-11T10:00:00.000Z');
    expect(snapshotIsEncrypted(bytes)).toBe(false);
  });
  it('encrypted: needs the password, a wrong one fails clearly, the right one reads it', () => {
    const { bytes, manifest } = buildSnapshot(data, meta, 'correct horse');
    expect(manifest.encrypted).toBe(true);
    expect(snapshotIsEncrypted(bytes)).toBe(true);
    expect(bytes.includes(Buffer.from('Shop'))).toBe(false); // nothing readable in the file
    expect(code(() => readSnapshot(bytes, { currentSchema: 17 }))).toBe('needs_password');
    expect(code(() => readSnapshot(bytes, { currentSchema: 17, password: 'wrong' }))).toBe(
      'wrong_password',
    );
    expect(readSnapshot(bytes, { currentSchema: 17, password: 'correct horse' }).data).toEqual(
      data,
    );
  });
  it('two encryptions of the same data differ (random salt and IV)', () => {
    expect(buildSnapshot(data, meta, 'p').bytes.equals(buildSnapshot(data, meta, 'p').bytes)).toBe(
      false,
    );
  });
  it('a changed encrypted file fails; a changed plain file fails its checksum', () => {
    const enc = buildSnapshot(data, meta, 'pw').bytes;
    const flipped = Buffer.from(enc);
    flipped[flipped.length - 5] ^= 0xff;
    expect(code(() => readSnapshot(flipped, { currentSchema: 17, password: 'pw' }))).toBe(
      'wrong_password',
    );
    // edit a row inside the gzip without fixing the manifest
    const plain = buildSnapshot(data, meta).bytes;
    const inner = JSON.parse(gunzipSync(plain.subarray(8)).toString());
    inner.files.invoices = inner.files.invoices.replace('118.5', '9999');
    const forged = Buffer.concat([
      plain.subarray(0, 8),
      gzipSync(Buffer.from(JSON.stringify(inner))),
    ]);
    expect(code(() => readSnapshot(forged, { currentSchema: 17 }))).toBe('tampered');
    // a table removed
    delete inner.files.parties;
    inner.files.invoices = JSON.stringify(data.invoices);
    expect(
      code(() =>
        readSnapshot(
          Buffer.concat([plain.subarray(0, 8), gzipSync(Buffer.from(JSON.stringify(inner)))]),
          { currentSchema: 17 },
        ),
      ),
    ).toBe('tampered');
  });
  it('a newer schema is refused; an older one is read', () => {
    const { bytes } = buildSnapshot(data, { ...meta, schema: 20 });
    expect(code(() => readSnapshot(bytes, { currentSchema: 17 }))).toBe('newer_schema');
    expect(
      readSnapshot(buildSnapshot(data, { ...meta, schema: 12 }).bytes, { currentSchema: 17 })
        .manifest.schema,
    ).toBe(12);
  });
  it('not a backup, and a file cut short', () => {
    expect(code(() => readSnapshot(Buffer.from('hello world'), { currentSchema: 17 }))).toBe(
      'bad_format',
    );
    const { bytes } = buildSnapshot(data, meta);
    expect(code(() => readSnapshot(bytes.subarray(0, 30), { currentSchema: 17 }))).toBe(
      'bad_format',
    );
    expect(
      code(() =>
        readSnapshot(buildSnapshot(data, meta, 'x').bytes.subarray(0, 40), {
          currentSchema: 17,
          password: 'x',
        }),
      ),
    ).toBe('bad_format');
  });
});
