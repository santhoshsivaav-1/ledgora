import { useMemo, useState } from 'react';
import { buildEinvoice, checkIrnDetails, validateEinvoice } from '@ledgora/tax-engine';
import Modal from '../../../components/ui/Modal';
import { toast } from '../../../components/ui/Toast';
import { confirmAction } from '../../../components/ui/ConfirmModal';
import { saveBill } from '../../../lib/data';
import { einvoiceCancellable, einvoiceDocFromBill, einvoiceLocked, einvoiceOf } from '../einvoice';

// Vyapar parity P10-S7, offline (D-15). 1) Check and download the IRP JSON. 2) Upload it on the IRP portal
// (einvoice1.gst.gov.in → e-Invoice → Bulk Upload). 3) Paste back what the IRP returned; the bill is then locked and its
// print carries the signed QR. Nothing is sent to any server but our own, and no IRP credentials are stored.

const blank = { irn: '', ackNo: '', ackDt: '', signedQr: '' };

export default function EinvoiceDialog({ bill, onClose, onSaved }) {
  const json = useMemo(() => buildEinvoice(einvoiceDocFromBill(bill)), [bill]);
  const problems = useMemo(() => validateEinvoice(json), [json]);
  const current = einvoiceOf(bill);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const errs = checkIrnDetails(form);
  const shown = Object.values(form).some(Boolean);

  const download = () => {
    const blob = new Blob([JSON.stringify([json], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `einvoice_${String(bill.invoiceNumber).replace(/[^A-Za-z0-9-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const store = async (einvoice) => {
    setBusy(true);
    try {
      const next = { ...bill, data: { ...bill.data, invoiceOptions: { ...(bill.data?.invoiceOptions || {}), einvoice } } };
      await saveBill(next, { overwrite: true });
      onSaved?.(next);
      onClose();
    } catch {
      toast('Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };
  const saveIrn = () => {
    if (errs.length) return;
    store({ ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v).trim()])), status: 'generated', recordedAt: new Date().toISOString() })
      .then(() => toast('IRN saved. The invoice is locked and prints with the QR.', 'success'));
  };
  const cancelIrn = async () => {
    if (!(await confirmAction({ title: 'Cancel this IRN?', message: 'First cancel it on the IRP portal (within 24 hours of its acknowledgement). The invoice unlocks here; a cancelled IRN can not be used again, so issue a new invoice number if you re-register it.', confirmLabel: 'IRN cancelled on the portal', tone: 'danger' }))) return;
    store({ ...current, status: 'cancelled', cancelledAt: new Date().toISOString() }).then(() => toast('IRN marked cancelled', 'success'));
  };

  return (
    <Modal open title={`E-invoice ${bill.invoiceNumber}`} onClose={onClose} size="lg">
      {einvoiceLocked(bill) ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0 }}><strong>IRN generated</strong> · Ack No {current.ackNo} · {current.ackDt}</p>
          <code style={{ wordBreak: 'break-all', fontSize: '0.78rem' }}>{current.irn}</code>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(current.irn).then(() => toast('IRN copied', 'success'))}>Copy IRN</button>
            {einvoiceCancellable(bill)
              ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancelIrn}>Mark IRN cancelled</button>
              : <span className="field-hint">More than 24 hours since acknowledgement: correct it with a credit note.</span>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <section>
            <h4 style={{ margin: '0 0 4px' }}>1. Check and download</h4>
            {problems.length ? (
              <ul className="ui-error" style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem' }}>
                {problems.map((p) => <li key={p.field}>{p.message}</li>)}
              </ul>
            ) : <p className="field-hint" style={{ margin: 0 }}>Ready: {json.ItemList.length} line{json.ItemList.length === 1 ? '' : 's'}, invoice value ₹{json.ValDtls.TotInvVal.toLocaleString('en-IN')}.</p>}
            <button type="button" className="btn btn-primary" style={{ marginTop: 6 }} disabled={problems.length > 0} onClick={download}>Download IRP JSON</button>
            {current?.status === 'cancelled' && <p className="field-hint">An earlier IRN for this invoice was cancelled; the IRP will refuse the same number again.</p>}
          </section>
          <section>
            <h4 style={{ margin: '0 0 4px' }}>2. Upload it on the IRP portal</h4>
            <p className="field-hint" style={{ margin: 0 }}>einvoice1.gst.gov.in → e-Invoice → Bulk Upload. E-invoicing is required above the turnover limit notified for your business; check it with your CA.</p>
          </section>
          <section>
            <h4 style={{ margin: '0 0 4px' }}>3. Paste back what the IRP returned</h4>
            <div className="grid grid-cols-2 gap-3">
              {[['irn', 'IRN', 'span 2'], ['ackNo', 'Ack No'], ['ackDt', 'Ack date (YYYY-MM-DD HH:MM:SS)'], ['signedQr', 'Signed QR code', 'span 2']].map(([k, label, span]) => (
                <label key={k} style={{ gridColumn: span }}>
                  <span className="form-label">{label}</span>
                  {k === 'signedQr'
                    ? <textarea className="form-input" rows={3} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    : <input className="form-input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
                  {shown && errs.find((x) => x.field === k) && <span className="ui-error">{errs.find((x) => x.field === k).message}</span>}
                </label>
              ))}
            </div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || errs.length > 0} onClick={saveIrn}>Save IRN and lock invoice</button>
          </section>
        </div>
      )}
    </Modal>
  );
}
