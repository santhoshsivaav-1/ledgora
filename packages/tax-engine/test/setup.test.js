import { describe, expect, it } from 'vitest';
import { DISMISS_AT, setupChecklist } from '../src/index.ts';

const none = { businessName: false, gstinAndAddress: false, bankAccount: false, item: false, party: false, invoice: false, teamMember: false, backup: false };
describe('setup checklist', () => {
  it('ticks itself from the facts and counts', () => {
    const c = setupChecklist({ ...none, businessName: true, item: true, party: true });
    expect(c).toMatchObject({ done: 3, total: 8, percent: 38, canDismiss: false, showDot: true });
    expect(c.rows.find((r) => r.id === 'item').done).toBe(true);
    expect(c.rows.find((r) => r.id === 'invoice').done).toBe(false);
  });
  it('can be dismissed from 5 of 8; the dot stays until 100% unless dismissed', () => {
    const five = { ...none, businessName: true, gstinAndAddress: true, item: true, party: true, invoice: true };
    expect(DISMISS_AT).toBe(5);
    expect(setupChecklist(five)).toMatchObject({ canDismiss: true, dismissed: false, showDot: true });
    expect(setupChecklist(five, true)).toMatchObject({ dismissed: true, showDot: false });
    expect(setupChecklist({ ...none, item: true }, true)).toMatchObject({ dismissed: false, showDot: true }); // too early to dismiss
    expect(setupChecklist(Object.fromEntries(Object.keys(none).map((k) => [k, true])))).toMatchObject({ percent: 100, showDot: false });
  });
});
