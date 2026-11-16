// R2.5 step 1: the department's ITR-3 schema for AY 2026-27 is on file and the checker uses it.
import { describe, expect, it } from 'vitest';
import { validateItr3Schema, ITR3_SCHEMAS } from '../src/itr3Schema.ts';

describe('ITR-3 schema on file', () => {
  it('has AY 2026-27', () => {
    expect(Object.keys(ITR3_SCHEMAS)).toEqual(['2026-27']);
  });
  it('rejects a file with no ITR3 section and tags the issue', () => {
    const issues = validateItr3Schema({ ITR: {} });
    expect(issues.some((i) => /ITR3/.test(i.message))).toBe(true);
    expect(issues.every((i) => i.code === 'ITR3_SCHEMA')).toBe(true);
  });
  it('rejects an ITR3 section missing its required parts', () => {
    const issues = validateItr3Schema({ ITR: { ITR3: {} } });
    for (const part of ['CreationInfo', 'PartA_GEN1', 'PARTA_BS', 'ITR3ScheduleBP', 'Verification'])
      expect(issues.some((i) => i.message.includes(part))).toBe(true);
  });
  it('refuses an assessment year with no schema', () => {
    expect(() => validateItr3Schema({}, '2030-31')).toThrow(/No ITR-3 schema/);
  });
});
