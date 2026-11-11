// Cash & Bank (Vyapar parity Phase 5): bank accounts, cash in hand, transfers, cheques, loans, reconciliation and the
// Home widgets. Like accounting.js this talks to the typed /v1 API; every amount on these screens comes from the ledger.

import {
  bankFromIfsc,
  emi,
  normalizeStatementDate,
  parseBankStatement,
} from '@ledgora/tax-engine';
import { apiClient } from '../apiClient';
import { readXlsx, rowsToCsv } from '../xlsx';

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const enc = encodeURIComponent;

export const cashbankSettings = (businessId) => apiClient.get(`/v1/cashbank/settings?${qs({ businessId })}`);
export const saveCashbankSettings = (body) => apiClient.put('/v1/cashbank/settings', body);
export const moneyAccounts = async (businessId) => (await apiClient.get(`/v1/cashbank/accounts?${qs({ businessId })}`)).data;
export const cashbankSummary = (businessId) => apiClient.get(`/v1/cashbank/summary?${qs({ businessId })}`);

export const listBankAccounts = async (businessId, all = false) => (await apiClient.get(`/v1/bank-accounts?${qs({ businessId, all: all ? '1' : '0' })}`)).data;
export const createBankAccount = (body) => apiClient.post('/v1/bank-accounts', body);
export const updateBankAccount = (id, patch) => apiClient.patch(`/v1/bank-accounts/${enc(id)}`, patch);
export const deleteBankAccount = (id) => apiClient.delete(`/v1/bank-accounts/${enc(id)}`);
export const bankStatement = (id, params = {}) => apiClient.get(`/v1/bank-accounts/${enc(id)}/transactions?${qs(params)}`);
export const cashStatement = (businessId, params = {}) => apiClient.get(`/v1/cash/transactions?${qs({ businessId, ...params })}`);

export const createCashEntry = (body) => apiClient.post('/v1/cash/entries', body);
export const deleteCashEntry = (id) => apiClient.delete(`/v1/cash/entries/${enc(id)}`);
export const dayEndCount = (body) => apiClient.post('/v1/cash/count', body);

export const listTransfers = async (businessId) => (await apiClient.get(`/v1/transfers?${qs({ businessId })}`)).data;
export const createTransfer = (body) => apiClient.post('/v1/transfers', body);
export const updateTransfer = (id, body) => apiClient.put(`/v1/transfers/${enc(id)}`, body);
export const deleteTransfer = (id) => apiClient.delete(`/v1/transfers/${enc(id)}`);

export const listCheques = async (businessId, filter = {}) => (await apiClient.get(`/v1/cheques?${qs({ businessId, ...filter })}`)).data;
export const createCheque = (body) => apiClient.post('/v1/cheques', body);
export const chequeAction = (id, body) => apiClient.post(`/v1/cheques/${enc(id)}/actions`, body);
export const updateCheque = (id, patch) => apiClient.patch(`/v1/cheques/${enc(id)}`, patch);

export const listLoans = async (businessId) => (await apiClient.get(`/v1/loans?${qs({ businessId })}`)).data;
export const getLoan = (id) => apiClient.get(`/v1/loans/${enc(id)}`);
export const createLoan = (body) => apiClient.post('/v1/loans', body);
export const deleteLoan = (id) => apiClient.delete(`/v1/loans/${enc(id)}`);
export const payLoan = (id, body) => apiClient.post(`/v1/loans/${enc(id)}/payments`, body);
export const deleteLoanPayment = (id, paymentId) => apiClient.delete(`/v1/loans/${enc(id)}/payments/${enc(paymentId)}`);
export const loanStatement = (id) => apiClient.get(`/v1/loans/${enc(id)}/statement`);
/** §194A at credit: interest credited to the lender before it is paid (TDS is kept now). */
export const creditLoanInterest = (id, body) => apiClient.post(`/v1/loans/${enc(id)}/interest-credits`, body);
export const deleteLoanInterestCredit = (id, creditId) => apiClient.delete(`/v1/loans/${enc(id)}/interest-credits/${enc(creditId)}`);

/** 31 March of the financial year a date falls in: the usual day to credit the year's interest. */
export const fyEndOf = (date) => {
  const [y, m] = String(date).split('-').map(Number);
  return `${m >= 4 ? y + 1 : y}-03-31`;
};
export const loanTaxSummary = (businessId, fy) => apiClient.get(`/v1/loans/tax-summary?${qs({ businessId, fy })}`);

export const matchStatementRows = (bankId, body) => apiClient.post(`/v1/bank-accounts/${enc(bankId)}/reconcile/match`, body);
export const saveReconciliation = (bankId, body) => apiClient.post(`/v1/bank-accounts/${enc(bankId)}/reconcile`, body);
export const ignoreStatementRows = (bankId, rows) => apiClient.post(`/v1/bank-accounts/${enc(bankId)}/reconcile/ignore`, { rows });

// ---- what the screens show ---------------------------------------------------------------------------------------------

/** Button labels and tones for a cheque's allowed actions, in the order the register shows them. */
const ACTION_UI = {
  deposit: { label: 'Deposit', tone: 'primary' },
  clear: { label: 'Cleared', tone: 'primary' },
  bounce: { label: 'Bounced', tone: 'danger' },
  cancel: { label: 'Cancel', tone: 'secondary' },
};
export const chequeButtons = (cheque) => (cheque?.actions ?? []).map((a) => ({ action: a, ...ACTION_UI[a] }));

export const CHEQUE_STATUS_TONE = { open: 'info', deposited: 'warning', cleared: 'success', bounced: 'danger', cancelled: 'neutral' };

/**
 * The Add Loan form's EMI as the owner types: the formula's figure unless they typed their own. `edited` = the EMI
 * field was changed by hand, so it is kept.
 */
export function loanFormEmi(form) {
  if (form.emiEdited && Number(form.emi) > 0) return Number(form.emi);
  return emi({ principal: Number(form.principal) || 0, ratePct: Number(form.ratePct) || 0, months: Math.floor(Number(form.tenureMonths) || 0), type: form.interestType });
}

/** The bank name an IFSC belongs to, for the Add Bank Account form ('' when unknown). */
export const ifscBank = (ifsc) => bankFromIfsc(String(ifsc || '').trim().toUpperCase());

/**
 * A bank statement CSV as rows the reconcile endpoint takes: dates as YYYY-MM-DD, rows without a usable date (opening
 * balance lines, footers) dropped. Returns `{ rows, skipped, bankName }`.
 */
export function statementRowsFromCsv(text) {
  const { bankName, transactions } = parseBankStatement(text);
  const rows = [];
  let skipped = 0;
  for (const t of transactions) {
    const date = normalizeStatementDate(t.date);
    const debit = Math.max(0, Number(t.debit) || 0);
    const credit = Math.max(0, Number(t.credit) || 0);
    if (!date || (!debit && !credit)) {
      skipped++;
      continue;
    }
    rows.push({ date, description: String(t.description ?? '').slice(0, 500), debit, credit, balance: Number.isFinite(Number(t.balance)) ? Number(t.balance) : null });
  }
  return { bankName, rows, skipped };
}

/** A statement file the user picked: CSV as text, .xlsx through the built-in reader (old .xls is refused with a hint). */
export async function statementRowsFromFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return statementRowsFromCsv(rowsToCsv(await readXlsx(await file.arrayBuffer())));
  return statementRowsFromCsv(await file.text());
}

/** What the §138 tracker says, by stage. */
export const SECTION_138_TEXT = {
  send_notice: { tone: 'warning', text: (s) => `Send the demand notice by ${s.noticeBy} (${s.daysLeft} days left)` },
  notice_overdue: { tone: 'danger', text: (s) => `The 30 days to send a notice ended on ${s.noticeBy}` },
  awaiting_payment: { tone: 'info', text: (s) => `Drawer has till ${s.payBy} to pay (${s.daysLeft} days)` },
  complaint_window: { tone: 'warning', text: (s) => `Complaint can be filed ${s.complaintFrom} to ${s.complaintBy} (${s.daysLeft} days left)` },
  complaint_lapsed: { tone: 'neutral', text: (s) => `The complaint window ended on ${s.complaintBy}` },
};

/**
 * Quick entries for a statement row that matches nothing in the books (P5-S6 "Create entry…"): what it can be recorded
 * as on this bank, by side. Party money (customers, suppliers) goes through Payment In / Out instead.
 */
export const RECON_QUICK = {
  debit: [
    { id: 'bank_charges', label: 'Bank charges', body: { kind: 'withdraw', direction: 'reduce', category: 'bank_charges' } },
    { id: 'drawings', label: 'Owner drawing', body: { kind: 'withdraw', direction: 'reduce', category: 'drawings' } },
    { id: 'to_cash', label: 'Cash withdrawn (to Cash in Hand)', transfer: 'to_cash' },
  ],
  credit: [
    { id: 'interest', label: 'Interest / other income', body: { kind: 'adjust', direction: 'increase', countAsIncome: true } },
    { id: 'capital', label: "Owner's capital", body: { kind: 'deposit', direction: 'increase' } },
    { id: 'from_cash', label: 'Cash deposited (from Cash in Hand)', transfer: 'from_cash' },
  ],
};

/** The statement's closing balance: the last row that has one. */
export const statementClosing = (rows) => {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].balance != null) return rows[i].balance;
  return null;
};

/** Where a cash or bank row's reference opens (null when there is no screen for it). */
export const cashbankRefLink = (refType) =>
  ({ invoice: '/invoices', purchase: '/purchases', payment: '/receipts', expense: '/expenses', cheque: '/cash-bank/cheques', transfer: '/cash-bank/transfers', loan: '/cash-bank/loans', loan_payment: '/cash-bank/loans' })[refType] ?? null;

/** A short label for the Type column of a statement. */
export const refTypeLabel = (refType) =>
  ({ invoice: 'Sale', purchase: 'Purchase', payment: 'Payment', expense: 'Expense', cheque: 'Cheque', transfer: 'Transfer', adjustment: 'Adjustment', loan: 'Loan', loan_payment: 'Loan payment', opening: 'Opening balance', journal: 'Journal' })[refType] ?? refType;

// ---- IFSC lookup (P5-S1 follow-up) ----------------------------------------------------------------------------------------

/** Bank, branch, address and MICR of an IFSC. The API asks the IFSC directory (the browser never calls a third party). */
export const lookupIfsc = (ifsc) => apiClient.get(`/v1/ifsc/${enc(String(ifsc || '').trim().toUpperCase())}`);

// ---- Cash & Bank reports (Phase 6 P6-S6: Bank Statement, Loan Statement, Cheque Register) ------------------------------

/** The reports, in menu order (each opens /reports/cash-bank/:id). */
export const CASH_BANK_REPORTS = [
  { id: 'bank-statement', title: 'Bank Statement' },
  { id: 'loan-statement', title: 'Loan Statement' },
  { id: 'cheque-register', title: 'Cheque Register' },
];

/** Bank Statement report rows: an opening balance row, then each entry with its running balance. */
export function bankStatementRows(st) {
  const rows = [{ id: 'opening', date: '', description: 'Opening balance', reference: '', party: '', withdrawal: null, deposit: null, balance: st.opening, reconciled: '' }];
  for (const r of st.rows)
    rows.push({ id: r.id, date: r.txnDate, description: r.narration || refTypeLabel(r.refType), reference: refTypeLabel(r.refType), party: r.partyName || '', withdrawal: r.withdrawal || null, deposit: r.deposit || null, balance: r.running, reconciled: r.reconciled ? '✔' : '' });
  return rows;
}

const LOAN_KIND = { emi: 'EMI', part: 'Part payment', prepay: 'Prepayment', topup: 'Top-up' };
/**
 * Loan Statement report rows: the disbursal, then every payment in date order with its principal, interest, charges and
 * TDS, and the principal outstanding after it. The last balance equals the loan's outstanding (the schedule's).
 */
export function loanStatementRows(loan) {
  let bal = Math.round(Number(loan.principal) * 100) / 100;
  const rows = [{ id: `${loan.id}-disbursal`, date: loan.receivedOn, type: 'Disbursal', principal: bal, interest: null, charges: loan.processingFee || null, tds: null, balance: bal }];
  // Interest credited (§194A at credit) is a row of its own: interest and TDS, no principal, so the balance stays.
  const events = [
    ...(loan.payments || []).map((p) => ({ ...p, _t: 'pay' })),
    ...(loan.credits || []).map((c) => ({ ...c, _t: 'credit' })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const p of events) {
    if (p._t === 'credit') {
      rows.push({ id: p.id, date: p.date, type: 'Interest credited', principal: null, interest: p.amount, charges: null, tds: p.tdsAmount || null, balance: bal });
      continue;
    }
    bal = Math.round((bal + (p.kind === 'topup' ? p.principal : -p.principal)) * 100) / 100;
    // Interest already credited is not counted again when it is paid.
    const fresh = Math.round(((p.interest || 0) - (p.accruedSettled || 0)) * 100) / 100;
    rows.push({ id: p.id, date: p.date, type: LOAN_KIND[p.kind] ?? p.kind, principal: p.principal || null, interest: fresh || null, charges: p.charges || null, tds: p.tdsAmount || null, balance: bal });
  }
  return rows;
}

/** Cheque Register report rows, with how many days an open or deposited cheque is past its date. */
export function chequeRegisterRows(cheques, today) {
  const day = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  return cheques.map((c) => ({
    id: c.id,
    direction: c.direction === 'received' ? 'Received' : 'Issued',
    number: c.number,
    party: c.partyName,
    amount: c.amount,
    date: c.chequeDate,
    status: c.stale ? `${c.status} (stale)` : c.status,
    daysOverdue: (c.status === 'open' || c.status === 'deposited') && day(today) > day(c.chequeDate) ? Math.round(day(today) - day(c.chequeDate)) : null,
  }));
}
