import { useEffect, useState } from 'react';
import { toast } from '../../components/ui/Toast';
import { localToday } from '../../utils';
import { recordEway } from '../../lib/data/reports';
import { runServerReport } from './definitions';

// P6-S5: the e-way bill register shows what you recorded; this is where you record it. Pick a goods invoice of ₹50,000 or
// more, then the number, vehicle and validity the e-way bill portal gave.

const errText = (e) => e?.body?.error?.message || e?.message || 'Something went wrong';

export default function EwayRecorder({ businessId, onSaved }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({
    invoiceId: '',
    ewayNo: '',
    vehicleNo: '',
    status: 'generated',
    validUntil: '',
  });
  useEffect(() => {
    runServerReport('eway-register', businessId, {
      period: { from: `${new Date().getFullYear() - 1}-04-01`, to: localToday() },
    })
      .then((r) => setRows(r.rows))
      .catch(() => {});
  }, [businessId]);
  const save = async () => {
    try {
      await recordEway(f.invoiceId, {
        ewayNo: f.ewayNo,
        vehicleNo: f.vehicleNo,
        status: f.status,
        validUntil: f.validUntil || null,
      });
      toast('E-way bill recorded', 'success');
      setF({ invoiceId: '', ewayNo: '', vehicleNo: '', status: 'generated', validUntil: '' });
      onSaved();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  return (
    <div
      className="glass-panel p-4 mb-6"
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
    >
      <label style={{ minWidth: 220 }}>
        <span className="form-label">Record for invoice</span>
        <select
          className="form-input"
          value={f.invoiceId}
          onChange={(e) => setF({ ...f, invoiceId: e.target.value })}
        >
          <option value="">Select a goods invoice…</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.number} · {r.party} · ₹{r.value.toLocaleString('en-IN')} · {r.status}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="form-label">E-way bill no</span>
        <input
          className="form-input"
          style={{ width: 150 }}
          value={f.ewayNo}
          onChange={(e) => setF({ ...f, ewayNo: e.target.value })}
        />
      </label>
      <label>
        <span className="form-label">Vehicle</span>
        <input
          className="form-input"
          style={{ width: 130 }}
          value={f.vehicleNo}
          onChange={(e) => setF({ ...f, vehicleNo: e.target.value.toUpperCase() })}
          placeholder="TN09AB1234"
        />
      </label>
      <label>
        <span className="form-label">Valid until</span>
        <input
          type="date"
          className="form-input"
          value={f.validUntil}
          onChange={(e) => setF({ ...f, validUntil: e.target.value })}
        />
      </label>
      <label>
        <span className="form-label">Status</span>
        <select
          className="form-input"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value })}
        >
          <option value="generated">Generated</option>
          <option value="cancelled">Cancelled</option>
          <option value="pending">Pending</option>
        </select>
      </label>
      <button
        className="btn btn-primary"
        disabled={!f.invoiceId || (f.status === 'generated' && !f.ewayNo.trim())}
        onClick={save}
      >
        Save
      </button>
    </div>
  );
}
