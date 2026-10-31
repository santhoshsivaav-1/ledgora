import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowRightCircle, Plus, Wallet, FileMinus } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import HelpButton from '../../components/ui/HelpButton';
import { LoadingState } from '../../components/ui/States';
import { getAllBills } from '../../lib/data';
import { amountDue, belongsToProfile, formatCurrency, INVOICE_TYPES, isCancelledBill, SALES_INVOICE_TYPES } from '../../utils';
import { NEXT_STEPS, PIPELINE, SALES_PAGES, nextStepsFor } from './salesFlow';

const sumOf = (list, pick = (b) => b.totalAmount) => list.reduce((t, b) => t + (Number(pick(b)) || 0), 0);
const dueOf = (b) => Math.max(0, amountDue(b) - (b.paidAmount || 0));

// The home of the Sales menu: the whole flow on one screen, how many documents sit at each stage, and what is
// waiting for its next step. Every number is a link to the page behind it.
export default function SalesOverview({ activeProfile, onNew, onConvert, go }) {
  const [allBills, setAllBills] = useState(null);
  useEffect(() => {
    let live = true;
    getAllBills().then((b) => live && setAllBills(Array.isArray(b) ? b : [])).catch(() => live && setAllBills([]));
    return () => { live = false; };
  }, []);

  const bills = useMemo(() => (allBills || []).filter((b) => belongsToProfile(b, activeProfile)), [allBills, activeProfile]);

  const stats = useMemo(() => {
    const live = bills.filter((b) => !isCancelledBill(b));
    const ofTypes = (types) => live.filter((b) => types.includes(b.invoiceType || 'tax-invoice'));
    const stages = PIPELINE.map((st) => {
      const docs = ofTypes(st.types);
      const open = docs.filter((b) => !b.convertedTo);
      return { ...st, docs, open, value: sumOf(docs) };
    });
    const invoices = ofTypes(SALES_INVOICE_TYPES);
    const today = new Date().toISOString().slice(0, 10);
    const unpaid = invoices.filter((b) => b.status !== 'paid' && dueOf(b) > 0.01);
    const overdue = unpaid.filter((b) => b.status === 'overdue' || (b.data?.details?.dueDate && b.data.details.dueDate < today));
    const credit = ofTypes(['credit-note']);
    const proforma = ofTypes(['proforma']);
    // Oldest first: the documents that have waited longest for their next step.
    const waiting = live
      .filter((b) => !b.convertedTo && nextStepsFor(b).some((st) => !st.linkOnly))
      .sort((a, b) => String(a.invoiceDate).localeCompare(String(b.invoiceDate)));
    return {
      stages, invoices, unpaid, overdue, credit, proforma, waiting,
      collected: sumOf(invoices, (b) => b.paidAmount),
      outstanding: sumOf(unpaid, dueOf),
    };
  }, [bills]);

  if (allBills === null) return <LoadingState />;

  const attention = [
    { label: 'Quotations not yet accepted into an order or invoice', n: stats.stages[0].open.length, page: 'sales-quotes' },
    { label: 'Sales orders not yet delivered or billed', n: stats.stages[1].open.length, page: 'sales-orders' },
    { label: 'Delivery challans not yet invoiced', n: stats.stages[2].open.length, page: 'sales-challans' },
    { label: 'Proforma invoices not yet billed', n: stats.proforma.filter((b) => !b.convertedTo).length, page: 'sales-proforma' },
    { label: 'Overdue invoices', n: stats.overdue.length, page: 'sales-invoices', tone: 'red' },
  ].filter((a) => a.n > 0);

  return (
    <div className="dashboard-container sales-overview">
      <PageHeader compact title="Sales" meta={`${bills.length} document${bills.length === 1 ? '' : 's'}`}>
        <HelpButton title="Sales — how the flow works" doc="dashboard">
          <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
            <li><strong>Quotation</strong> — a priced offer. Not a sale and not in your GST returns.</li>
            <li><strong>Sales order</strong> — the client has accepted. Raise it from a quotation, or directly.</li>
            <li><strong>Delivery challan</strong> — goods leave before they are billed. Stock goes out here.</li>
            <li><strong>Invoice</strong> — the sale. It reaches your GST returns and starts collecting payment.</li>
            <li><strong>Receipt</strong> — payment recorded against an invoice.</li>
            <li><strong>Credit note</strong> — a return or correction after an invoice.</li>
            <li>You can skip steps: a quotation can become an invoice directly, or an invoice can be made from scratch. Each document you raise from another is linked to it and closes it, so nothing gets billed twice.</li>
          </ul>
        </HelpButton>
        <button className="btn btn-primary" onClick={() => onNew('tax-invoice')}><Plus size={18} /> New Invoice</button>
      </PageHeader>

      <div className="flow-board" aria-label="Sales flow">
        {stats.stages.map((st) => (
          <div key={st.key} className="flow-board-step">
            <div className="flow-stage">
              <button type="button" className="flow-stage-main" onClick={() => go(st.page)}>
                <span className="flow-stage-label">{st.label}s</span>
                <span className="flow-stage-count">{st.docs.length}</span>
                <span className="flow-stage-value">{formatCurrency(st.value)}</span>
                <span className="flow-stage-sub">
                  {st.key === 'tax-invoice'
                    ? `${formatCurrency(stats.outstanding)} to collect`
                    : `${st.open.length} waiting for next step`}
                </span>
              </button>
              <button type="button" className="flow-stage-new" onClick={() => onNew(st.newType)} title={`New ${INVOICE_TYPES[st.newType].label}`}>
                <Plus size={14} /> New
              </button>
            </div>
            <ArrowRight size={18} className="flow-arrow" aria-hidden="true" />
          </div>
        ))}
        <div className="flow-board-step">
          <div className="flow-stage">
            <button type="button" className="flow-stage-main" onClick={() => go('receipts')}>
              <span className="flow-stage-label">Payments</span>
              <span className="flow-stage-count"><Wallet size={20} /></span>
              <span className="flow-stage-value">{formatCurrency(stats.collected)}</span>
              <span className="flow-stage-sub">collected on invoices</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flow-branch">
        <button type="button" className="flow-branch-card" onClick={() => go('sales-credit')}>
          <FileMinus size={16} />
          <span><strong>Credit notes</strong> — returns and corrections after an invoice</span>
          <span className="flow-branch-n">{stats.credit.length} · {formatCurrency(sumOf(stats.credit))}</span>
        </button>
        <button type="button" className="flow-branch-card" onClick={() => go('sales-proforma')}>
          <ArrowRightCircle size={16} />
          <span><strong>Proforma</strong> — advance or estimate invoices, billed later</span>
          <span className="flow-branch-n">{stats.proforma.length} · {formatCurrency(sumOf(stats.proforma))}</span>
        </button>
      </div>

      <div className="flow-columns">
        <div className="glass-panel flow-panel">
          <div className="table-header"><h3>Needs attention</h3></div>
          {attention.length === 0 ? (
            <p className="text-muted" style={{ margin: 0, padding: '0.5rem 0.25rem' }}>Nothing is waiting. Every document has been followed through.</p>
          ) : (
            <ul className="flow-attention">
              {attention.map((a) => (
                <li key={a.label}>
                  <button type="button" onClick={() => go(a.page)}>
                    <span className={`flow-attention-n${a.tone ? ` flow-attention-${a.tone}` : ''}`}>{a.n}</span>
                    <span>{a.label}</span>
                    <ArrowRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass-panel flow-panel">
          <div className="table-header"><h3>Waiting for the next step</h3></div>
          {stats.waiting.length === 0 ? (
            <p className="text-muted" style={{ margin: 0, padding: '0.5rem 0.25rem' }}>No open quotations, orders, challans or proformas.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Document</th><th>Client</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
              <tbody>
                {stats.waiting.slice(0, 8).map((b) => {
                  const step = nextStepsFor(b).find((st) => !st.linkOnly);
                  return (
                    <tr key={b.id}>
                      <td><span className="invoice-badge">{b.invoiceNumber}</span><span className="flow-ref">{INVOICE_TYPES[b.invoiceType]?.label}</span></td>
                      <td className="td-client" title={b.clientName}>{b.clientName}</td>
                      <td className="text-muted">{new Date(b.invoiceDate).toLocaleDateString('en-IN')}</td>
                      <td className="font-bold" style={{ textAlign: 'right' }}>{formatCurrency(b.totalAmount, b.currency || 'INR')}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', whiteSpace: 'nowrap' }}
                          onClick={() => onConvert(b, step)}>
                          {step.label} <ArrowRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {stats.waiting.length > 8 && <p className="text-muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>and {stats.waiting.length - 8} more — open the page for each stage to see them all.</p>}
        </div>
      </div>

      <div className="flow-links">
        {SALES_PAGES.map((p) => (
          <button key={p.id} type="button" className="flow-link" onClick={() => go(p.id)}>{p.label}</button>
        ))}
        <button type="button" className="flow-link" onClick={() => go('invoices')}>All documents</button>
      </div>
    </div>
  );
}

// kept for tests and other screens that want to describe the flow
export { NEXT_STEPS };
