import { describe, expect, it } from 'vitest';
import { parseSettingsPatch } from '@ledgora/contracts';
import { BIZ_DEFAULTS, applyBizDefaults, settingsFrom } from '../src/features/auth/setupRules';

const form = (over = {}) => ({
  regType: 'unregistered', fyStart: '4', defaultGst: '18', taxInclusive: false, bizType: 'retail', bizCategory: '', compRate: '1',
  terms: BIZ_DEFAULTS.retail.terms, defaultUnit: BIZ_DEFAULTS.retail.unit, ...over,
});

describe('business-type defaults', () => {
  it('moves the terms and unit with the business type', () => {
    const f = applyBizDefaults(form(), 'service');
    expect(f.bizType).toBe('service');
    expect(f.terms).toBe(BIZ_DEFAULTS.service.terms);
    expect(f.defaultUnit).toBe('NOS');
  });
  it('keeps what the person typed', () => {
    const f = applyBizDefaults(form({ terms: 'My own terms', defaultGst: '12' }), 'wholesale');
    expect(f.terms).toBe('My own terms');
    expect(f.defaultGst).toBe('12');
    expect(f.defaultUnit).toBe('PCS');
  });
  it('every default unit and the whole settings payload are valid registry values', () => {
    for (const [type, d] of Object.entries(BIZ_DEFAULTS)) {
      const out = settingsFrom(form({ bizType: type, terms: d.terms, defaultUnit: d.unit }));
      expect(parseSettingsPatch(out).errors, type).toEqual([]);
      expect(out['txn.terms.text'].length).toBeLessThanOrEqual(1000);
    }
  });
});
