// Expenses, and Other Income (Vyapar parity P3-S6), which share the `expenses` collection: `kind: 'income'` marks
// income; missing means an expense, as on every record saved before Phase 3.

import { API, apiFetch } from './api';

export const isIncome = (e) => e?.kind === 'income';

const allRecords = async () => apiFetch(`${API}/collections/expenses`);

// ---- Expenses ----
/** Expenses only: what every screen read before Phase 3, so they keep reading the same thing. */
export const getAllExpenses = async () => {
  const rows = await allRecords();
  return Array.isArray(rows) ? rows.filter((e) => !isIncome(e)) : rows;
};

/** P3-S6 other income. */
export const getAllOtherIncome = async () => (await allRecords() || []).filter(isIncome);

export const saveExpense = async (expense) => {
  const res = await apiFetch(`${API}/collections/expenses`, { method: 'POST', body: JSON.stringify(expense) });
  if (res.id) expense.id = res.id;
  return expense;
};

export const deleteExpense = async (id) => {
  return apiFetch(`${API}/collections/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

// ---- Expense setup (P3-S5): the user's own categories (a tree, with their P&L kind) and expense items ----
const SETUP_KEY = 'expenseSetup';
export const getExpenseSetup = async () => {
  const { value } = await apiFetch(`${API}/meta/${SETUP_KEY}`);
  return { categories: [], items: [], ...(value || {}) };
};
export const saveExpenseSetup = (setup) =>
  apiFetch(`${API}/meta/${SETUP_KEY}`, { method: 'POST', body: JSON.stringify({ value: setup }) });
