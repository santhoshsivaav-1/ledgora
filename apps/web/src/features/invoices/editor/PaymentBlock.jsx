import { Plus, X } from 'lucide-react';
import { isPostDated, syncInlinePayments } from '@ledgora/tax-engine';
import { Field, MoneyInput, Select, TextInput } from '../../../components/ui/Field';
import { StatusChip } from '../../../components/ui/Display';
import { formatCurrency, localToday } from '../../../utils';
import { PAYMENT_MODE_OPTIONS, earlierPaymentsOf, paymentSummary } from './saleExtras';

// Vyapar parity P2-S2: the Payment block of Add Sale. Credit / Cash sale type, up to six payment rows (mode,
// reference, cheque date, amount), received and balance underneath. Payments recorded elsewhere (a receipt, the
// Dashboard) show as read-only lines; the rows here are saved with the invoice. Over-paying disables Save.
// Phase 3 reuses it on Add Purchase with direction="out": the same rows, worded as money paid.

const MAX_ROWS = 6;

export default function PaymentBlock({ rows, onRowsChange, saleType, onSaleTypeChange, total, payments, currency, isOrder, direction = 'in' }) {
  const out = direction === 'out';
  const summary = paymentSummary(rows, { total, payments });
  const earlier = earlierPaymentsOf(payments);
  const set = (i, patch) => onRowsChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () =>
    onRowsChange([...rows, { mode: 'upi', amount: summary.balance || null, reference: '', chequeDate: '' }]);
  const pickType = (t) => {
    onSaleTypeChange(t);
    if (t === 'cash') onRowsChange(syncInlinePayments(rows, { saleType: 'cash', total, earlier: summary.earlier }));
  };
  const rowError = (i, code) => summary.errors.find((e) => e.row === i && e.code === code)?.message;
  const over = summary.errors.find((e) => e.code === 'OVER_ALLOCATED');

  return (
    <section className="glass-panel p-6 mb-6 sale-payment-block" aria-labelledby="sale-payment-title">
      <div className="sale-block-head">
        <h3 id="sale-payment-title" className="section-title">{isOrder ? (out ? 'Advance paid' : 'Advance received') : 'Payment'}</h3>
        {!isOrder && (
          <div className="sale-type-toggle" role="radiogroup" aria-label={out ? 'Purchase type' : 'Sale type'}>
            {['credit', 'cash'].map((t) => (
              <label key={t} className={`sale-type-opt${saleType === t ? ' active' : ''}`}>
                <input type="radio" name="sale-type" value={t} checked={saleType === t} onChange={() => pickType(t)} />
                {t === 'credit' ? 'Credit' : 'Cash'}
              </label>
            ))}
          </div>
        )}
      </div>

      {earlier.map((p, i) => (
        <div key={p.id || p.receiptNo || i} className="sale-payment-readonly">
          {out ? 'Paid' : 'Received'} {formatCurrency(p.amount, currency)} via {p.voucherNo || p.receiptNo || p.mode || 'payment'}
          {p.date ? ` on ${p.date}` : ''}
        </div>
      ))}

      {rows.map((r, i) => (
        <div key={r.id || i} className="sale-payment-row">
          <Field label={i === 0 ? 'Mode' : undefined}>
            <Select value={r.mode} onChange={(v) => set(i, { mode: v })} options={PAYMENT_MODE_OPTIONS} aria-label={`Payment ${i + 1} mode`} />
          </Field>
          <Field label={i === 0 ? 'Amount' : undefined} error={rowError(i, 'AMOUNT')}>
            <MoneyInput value={r.amount} onChange={(v) => set(i, { amount: v })} aria-label={`Payment ${i + 1} amount`} />
          </Field>
          <Field label={i === 0 ? 'Reference' : undefined}>
            <TextInput value={r.reference} onChange={(v) => set(i, { reference: v })} maxLength={80}
              placeholder={r.mode === 'cheque' ? 'Cheque no.' : r.mode === 'upi' ? 'UPI ref' : ''} aria-label={`Payment ${i + 1} reference`} />
          </Field>
          {r.mode === 'cheque' ? (
            <Field label={i === 0 || rows.some((x) => x.mode === 'cheque') ? 'Cheque date' : undefined} error={rowError(i, 'CHEQUE_DATE')}>
              <span className="sale-cheque-date">
                <input type="date" className="ui-input" value={r.chequeDate || ''} onChange={(e) => set(i, { chequeDate: e.target.value })} aria-label={`Payment ${i + 1} cheque date`} />
                {isPostDated(r.chequeDate, localToday()) && <StatusChip tone="warning">Post-dated</StatusChip>}
              </span>
            </Field>
          ) : (
            <span />
          )}
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => onRowsChange(rows.filter((_, j) => j !== i))} aria-label={`Remove payment ${i + 1}`}>
            <X size={16} />
          </button>
        </div>
      ))}

      <div className="sale-payment-foot">
        <button type="button" className="btn btn-secondary" onClick={add} disabled={rows.length >= MAX_ROWS}>
          <Plus size={14} /> Add payment mode
        </button>
        <span className="sale-payment-totals">
          {out ? 'Paid' : 'Received'} <strong>{formatCurrency(summary.paid, currency)}</strong>
          {!isOrder && (
            <>
              {' · '}Balance <strong>{formatCurrency(summary.balance, currency)}</strong>
              {summary.status === 'paid' && <StatusChip tone="success">Paid</StatusChip>}
            </>
          )}
        </span>
      </div>
      {over && !isOrder && <p className="ui-error" role="alert">{over.message}</p>}
    </section>
  );
}
