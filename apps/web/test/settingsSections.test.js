import { describe, expect, it } from 'vitest';
import { ALL_BACKUP_PARTS, autoTickFromInspection, buildRestoreSummary } from '../src/features/settings/settingsBackupParts';

// Phase 3 split: the pure bookkeeping behind Settings → Data Management
// (export/import category list and the import summary) lives in
// settingsBackupParts.js so it can be unit-tested without lib/data.

describe('ALL_BACKUP_PARTS', () => {
  it('lists every backup category with a label and a hint', () => {
    expect(ALL_BACKUP_PARTS.map((p) => p.id)).toEqual([
      'profile', 'profiles', 'bills', 'clients', 'products', 'expenses',
      'purchases', 'recurring', 'receipts', 'termsTemplates', 'meta', 'localStorage',
    ]);
    for (const part of ALL_BACKUP_PARTS) {
      expect(part.label, part.id).toBeTruthy();
      expect(part.hint, part.id).toBeTruthy();
    }
  });
});

describe('autoTickFromInspection', () => {
  it('ticks only the categories that have data in the inspected file', () => {
    const sel = autoTickFromInspection({ counts: { bills: 3, clients: 0, meta: 2 } });
    expect(sel.bills).toBe(true);
    expect(sel.meta).toBe(true);
    expect(sel.clients).toBe(false);
    // Categories missing from the inspection stay unticked, not undefined.
    expect(sel.profile).toBe(false);
    // Every category gets an entry — the checkboxes read off this map.
    expect(Object.keys(sel)).toHaveLength(ALL_BACKUP_PARTS.length);
  });

  it('ticks nothing when the file has no counts', () => {
    const sel = autoTickFromInspection({});
    expect(Object.values(sel).every(Boolean)).toBe(false);
  });
});

describe('buildRestoreSummary', () => {
  const inspection = { counts: { localStorage: 10 } };

  it('lists every restored category in the original order', () => {
    const result = {
      billCount: 2, hasProfile: true, profileCount: 1, templateCount: 3,
      clientCount: 4, productCount: 5, expenseCount: 6, purchaseCount: 7,
      recurringCount: 8, receiptCount: 9,
    };
    const summary = buildRestoreSummary(result, { localStorage: true }, inspection);
    expect(summary).toBe(
      'Restored: 2 invoice(s), profile, 1 business profile(s), 3 template(s), '
      + '4 client(s), 5 product(s), 6 expense(s), 7 purchase bill(s), '
      + '8 recurring invoice(s), 9 receipt(s), 10 local preference(s)',
    );
  });

  it('falls back to "Restore complete" when nothing was restored', () => {
    expect(buildRestoreSummary({}, {}, { counts: {} })).toBe('Restore complete');
  });

  it('ignores local preferences when the localStorage box was unticked', () => {
    const summary = buildRestoreSummary({}, { localStorage: false }, inspection);
    expect(summary).toBe('Restore complete');
  });
});
