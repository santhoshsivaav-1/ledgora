// Expenses.

import { API, apiFetch } from './api';

// ---- Expenses ----
export const getAllExpenses = async () => {
  return apiFetch(`${API}/collections/expenses`);
};

export const saveExpense = async (expense) => {
  const res = await apiFetch(`${API}/collections/expenses`, { method: 'POST', body: JSON.stringify(expense) });
  if (res.id) expense.id = res.id;
  return expense;
};

export const deleteExpense = async (id) => {
  return apiFetch(`${API}/collections/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
