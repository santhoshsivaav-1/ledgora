import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CONCURRENT_DIR, runConcurrent, statementsOf } from '@ledgora/db';
import { makeHarness } from './helpers.ts';

// P11-S2: the Appendix C indexes are built CONCURRENTLY after the migrations, are valid, and a second run is a no-op.
const h = makeHarness();
afterAll(() => h.close());
const file = readFileSync(join(CONCURRENT_DIR, '0001_p11_indexes.sql'), 'utf8');
const names = [...file.matchAll(/IF NOT EXISTS (p11_\w+)/g)].map((m) => m[1]!);

describe('concurrent indexes (P11-S2)', () => {
  it('splits the file into its statements, comments left out', () => {
    const s = statementsOf(file);
    expect(s[0]).toBe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(s.filter((x) => x.includes('CONCURRENTLY'))).toHaveLength(names.length);
    expect(s.some((x) => x.startsWith('--'))).toBe(false);
  });
  it('every index exists and is valid', async () => {
    const rows =
      await h.sql`select c.relname, i.indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname like 'p11_%'`;
    expect(rows.map((r) => r.relname).sort()).toEqual([...names].sort());
    expect(rows.every((r) => r.indisvalid)).toBe(true);
  });
  it('a second run applies nothing', async () => {
    expect(await runConcurrent(h.sql)).toEqual([]);
  });
});
