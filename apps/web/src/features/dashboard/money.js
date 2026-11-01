// Money formatting for the analytics dashboard: whole rupees in full, and a compact form (1.2L, 3.4Cr) for chart axes.

export const compactMoney = (n, currency = 'INR') =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
  }).format(n || 0);

export const fullMoney = (n, currency = 'INR') =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(n || 0);
