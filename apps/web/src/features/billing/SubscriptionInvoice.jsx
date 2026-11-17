import { useEffect, useState } from 'react';
import { Printer, ArrowLeft } from 'lucide-react';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { getInvoice } from '../../lib/data/billing';
import './billing.css';
import { fmtDate } from './planFormat';

// One GST tax invoice for a Ledgora subscription payment, laid out to print or save as PDF from the browser.
const money = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SubscriptionInvoice({ id, onBack }) {
  const [inv, setInv] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getInvoice(id).then(setInv).catch(setError); }, [id]);
  if (error) return <ErrorState message={error.message} onRetry={onBack} />;
  if (!inv) return <LoadingState label="Opening the invoice…" />;
  const { seller, buyer } = inv;
  const taxed = inv.cgst + inv.sgst + inv.igst > 0;
  const plan = `${inv.plan[0].toUpperCase()}${inv.plan.slice(1)} plan, ${inv.interval === 'year' ? 'yearly' : 'monthly'}`;
  return (
    <div className="sub-invoice-wrap">
      <div className="sub-invoice-actions no-print">
        <button type="button" className="btn btn-ghost" onClick={onBack}><ArrowLeft size={16} /> All invoices</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={16} /> Print or save as PDF</button>
      </div>
      <article className="sub-invoice" aria-label={`Invoice ${inv.number}`}>
        <header>
          <div>
            <h2>{taxed && seller.gstin ? 'Tax invoice' : 'Invoice'}</h2>
            <p><b>{seller.name}</b></p>
            {seller.address && <p>{seller.address}</p>}
            <p>{seller.state}{seller.gstin ? ` · GSTIN ${seller.gstin}` : ''}</p>
          </div>
          <dl>
            <dt>Invoice no.</dt><dd>{inv.number}</dd>
            <dt>Date</dt><dd>{fmtDate(inv.issuedAt)}</dd>
            <dt>SAC</dt><dd>{seller.sac}</dd>
          </dl>
        </header>
        <section aria-label="Billed to">
          <h3>Billed to</h3>
          <p><b>{buyer.name}</b></p>
          {buyer.address && <p>{buyer.address}</p>}
          <p>{buyer.state}{buyer.gstin ? ` · GSTIN ${buyer.gstin}` : ''}</p>
        </section>
        <table>
          <thead><tr><th>Description</th><th className="num">Taxable value</th></tr></thead>
          <tbody>
            <tr>
              <td>{plan} (software subscription){inv.periodStart && inv.periodEnd ? `, ${fmtDate(inv.periodStart)} to ${fmtDate(inv.periodEnd)}` : ''}</td>
              <td className="num">₹{money(inv.taxable)}</td>
            </tr>
          </tbody>
          <tfoot>
            {inv.cgst > 0 && <tr><td>CGST @ {seller.rate / 2}%</td><td className="num">₹{money(inv.cgst)}</td></tr>}
            {inv.sgst > 0 && <tr><td>SGST @ {seller.rate / 2}%</td><td className="num">₹{money(inv.sgst)}</td></tr>}
            {inv.igst > 0 && <tr><td>IGST @ {seller.rate}%</td><td className="num">₹{money(inv.igst)}</td></tr>}
            <tr className="total"><td>Total paid</td><td className="num">₹{money(inv.total)}</td></tr>
          </tfoot>
        </table>
        <p className="sub-invoice-note">This is a computer-generated invoice for a payment already received online.</p>
      </article>
    </div>
  );
}
