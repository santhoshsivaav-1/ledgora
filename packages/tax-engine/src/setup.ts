// Vyapar parity P7-S5: the Setup My Business checklist. Each row is a predicate over facts the API counts, so it ticks
// itself; nothing is stored but whether the owner dismissed the card.

export interface SetupFacts {
  businessName: boolean;
  gstinAndAddress: boolean;
  bankAccount: boolean;
  item: boolean;
  party: boolean;
  invoice: boolean;
  teamMember: boolean;
  backup: boolean;
}
export interface SetupRow {
  id: keyof SetupFacts;
  label: string;
  done: boolean;
  /** Where the row's button goes. */
  to: string;
  action: string;
}
const ROWS: Omit<SetupRow, 'done'>[] = [
  { id: 'businessName', label: 'Business name and logo', to: '/settings/business', action: 'Edit' },
  { id: 'gstinAndAddress', label: 'GSTIN and address', to: '/settings/business', action: 'Edit' },
  { id: 'bankAccount', label: 'Add a bank account', to: '/cash-bank/accounts', action: 'Add' },
  { id: 'item', label: 'Add your first item', to: '/products', action: 'Add' },
  { id: 'party', label: 'Add your first party', to: '/parties', action: 'Add' },
  { id: 'invoice', label: 'Create your first invoice', to: '/invoices/new', action: 'Create' },
  { id: 'teamMember', label: 'Invite your team', to: '/settings/team', action: 'Invite' },
  { id: 'backup', label: 'Set up backup', to: '/utilities/backup', action: 'Set up' },
];
/** Dismissible from this many done rows. */
export const DISMISS_AT = 5;

export function setupChecklist(facts: SetupFacts, dismissed = false) {
  const rows: SetupRow[] = ROWS.map((r) => ({ ...r, done: !!facts[r.id] }));
  const done = rows.filter((r) => r.done).length;
  return {
    rows,
    done,
    total: rows.length,
    percent: Math.round((done / rows.length) * 100),
    canDismiss: done >= DISMISS_AT,
    dismissed: dismissed && done >= DISMISS_AT,
    /** The red dot in the top bar: until every row is done, unless the owner dismissed the card. */
    showDot: done < rows.length && !(dismissed && done >= DISMISS_AT),
  };
}
