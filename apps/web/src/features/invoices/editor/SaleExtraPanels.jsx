import { Field, Select } from '../../../components/ui/Field';
import { orderProgressFromBills } from './saleExtras';
import SalesmanPicker from './SalesmanPicker';

// Vyapar parity Phase 2 (flag sale.inlinePayments): the extra blocks a sale type can show under Details —
// the salesman, the expected delivery date of a sale order, and a credit note's reason / refund mode / restock
// choice — plus a saved sale order's progress table under Items.

export const RETURN_REASON_OPTIONS = [
  { value: 'sales-return', label: 'Sales return' },
  { value: 'post-sale-discount', label: 'Post-sale discount' },
  { value: 'deficiency-in-service', label: 'Deficiency in service' },
  { value: 'correction', label: 'Correction' },
  { value: 'others', label: 'Others' },
];
export const REFUND_OPTIONS = [
  { value: 'adjust', label: 'Adjust party balance' },
  { value: 'cash', label: 'Cash refund' },
  { value: 'bank', label: 'Bank refund' },
];

export function SaleDetailsExtra({ salesman, setSalesman, invoiceType, expectedDeliveryDate, setExpectedDeliveryDate, returnInfo, setReturnInfo }) {
  return (
    <div className="glass-panel p-6 mb-6 sale-details-extra">
      <SalesmanPicker value={salesman.salesmanId} name={salesman.salesmanName} onChange={setSalesman} />
      {invoiceType === 'sales-order' && (
        <Field label="Expected delivery">
          <input type="date" className="ui-input" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
        </Field>
      )}
      {invoiceType === 'credit-note' && (
        <>
          <Field label="Reason" help="Shown in GSTR-1 CDNR">
            <Select value={returnInfo.returnReason} onChange={(v) => setReturnInfo((r) => ({ ...r, returnReason: v }))} options={RETURN_REASON_OPTIONS} />
          </Field>
          <Field label="Refund">
            <Select value={returnInfo.refundMode} onChange={(v) => setReturnInfo((r) => ({ ...r, refundMode: v }))} options={REFUND_OPTIONS} />
          </Field>
          <label className="ui-check">
            <input type="checkbox" checked={returnInfo.restock !== false} onChange={(e) => setReturnInfo((r) => ({ ...r, restock: e.target.checked }))} />
            Put returned goods back in stock
          </label>
        </>
      )}
    </div>
  );
}

export function OrderProgressPanel({ editingBill, allBillsForCredit }) {
  const prog = orderProgressFromBills(editingBill, allBillsForCredit);
  return (
    <div className="glass-panel p-6 mb-6">
      <div className="sale-block-head">
        <h3 className="section-title">Order progress</h3>
        <span>{{ open: 'Open', 'partially-invoiced': 'Partially invoiced', closed: 'Closed', cancelled: 'Cancelled' }[prog.status]}</span>
      </div>
      <table className="data-table" style={{ width: '100%' }}>
        <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Ordered</th><th style={{ textAlign: 'right' }}>Invoiced</th><th style={{ textAlign: 'right' }}>Pending</th></tr></thead>
        <tbody>
          {prog.lines.map((l, i) => (
            <tr key={i}><td>{l.name}</td><td style={{ textAlign: 'right' }}>{l.ordered}</td><td style={{ textAlign: 'right' }}>{l.invoiced}</td><td style={{ textAlign: 'right' }}>{l.pending}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
