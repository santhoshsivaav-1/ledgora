// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).

import { formatCurrency, isCancelledBill, SALES_INVOICE_TYPES, amountDue } from '../../utils';

// The strip above a sales page's list: how many documents, their value, and how many are still waiting on a next step.
export default function ScopeSummary({ scope, bills }) {
  const live = bills.filter(b => !isCancelledBill(b));
  const open = live.filter(b => !b.convertedTo);
  const sum = (list) => list.reduce((t, b) => t + (Number(b.totalAmount) || 0), 0);
  const sales = scope.types.some(t => SALES_INVOICE_TYPES.includes(t));
  const credit = scope.types.includes('credit-note');
  const cards = sales
    ? [
        ['Documents', live.length, null],
        ['Billed', formatCurrency(sum(live)), null],
        ['Outstanding', formatCurrency(live.reduce((t, b) => t + (b.status === 'paid' ? 0 : Math.max(0, amountDue(b) - (b.paidAmount || 0))), 0)), 'amber'],
        ['Fully paid', live.filter(b => b.status === 'paid').length, 'green'],
      ]
    : credit
      ? [['Credit notes', live.length, null], ['Value credited', formatCurrency(sum(live)), 'amber']]
      : [
          ['Documents', live.length, null],
          ['Total value', formatCurrency(sum(live)), null],
          ['Waiting for next step', open.length, 'amber'],
          ['Converted', live.length - open.length, 'green'],
        ];
  return (
    <div className="scope-summary">
      {cards.map(([label, value, tone]) => (
        <div key={label} className={`scope-summary-card${tone ? ` scope-summary-${tone}` : ''}`}>
          <span className="scope-summary-label">{label}</span>
          <span className="scope-summary-value">{value}</span>
        </div>
      ))}
    </div>
  );
}
