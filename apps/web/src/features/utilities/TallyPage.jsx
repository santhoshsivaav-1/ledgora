import { useEffect, useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { DEFAULT_TALLY_MAPPING } from '@ledgora/tax-engine';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { downloadTally, saveTallyConfig, tallyConfig, tallyPreview } from '../../lib/data/utilities';
import { EnableAccounting, errText, isLedgerOff, useBusiness } from './shared';

// Vyapar parity P7-S2: Export to Tally. Step 1 the period, 2 what to include, 3 the ledger names Tally already has,
// 4 preview the counts and the problems, then download Master.xml (ledgers, taxes, units, stock items) and
// Voucher.xml. Errors block the download and name the document; warnings are listed and do not. Needs the ledger.
// The files follow Tally Prime's import format; import Master.xml first, then Voucher.xml.

const INCLUDE = [['sales', 'Sales'], ['salesReturns', 'Sales returns'], ['purchases', 'Purchases'], ['purchaseReturns', 'Purchase returns'], ['cancelled', 'Cancelled documents']];
const EXTRAS = [['receipts', 'Receipts (money in)'], ['payments', 'Payments (money out)'], ['expenses', 'Expenses and other income']];
const LEDGERS = [
  ['company', 'Company name in Tally'], ['sales', 'Sales ledger'], ['salesReturn', 'Sales return ledger'], ['purchase', 'Purchase ledger'], ['purchaseReturn', 'Purchase return ledger'],
  ['outCgst', 'Output CGST'], ['outSgst', 'Output SGST'], ['outIgst', 'Output IGST'], ['outCess', 'Output cess'],
  ['inCgst', 'Input CGST'], ['inSgst', 'Input SGST'], ['inIgst', 'Input IGST'], ['inCess', 'Input cess'],
  ['roundOff', 'Round off'], ['charges', 'Additional charges'], ['debtors', 'Customers go under'], ['creditors', 'Suppliers go under'],
  ['cash', 'Cash ledger'], ['bank', 'Bank ledger'], ['discountAllowed', 'Discount allowed'], ['discountReceived', 'Discount received'],
  ['tdsReceivable', 'TDS receivable'], ['tdsPayable', 'TDS payable'], ['expenses', 'Expense group'], ['otherIncome', 'Other income group'],
];
const fyStart = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; };
const today = () => new Date().toISOString().slice(0, 10);

export default function TallyPage() {
  const { biz, loading, error } = useBusiness();
  const [cfg, setCfg] = useState(null);
  const [off, setOff] = useState(null);
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(today());
  const [pre, setPre] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!biz) return;
    tallyConfig(biz.id).then(setCfg, (e) => (isLedgerOff(e) ? setOff(e.message) : setLoadError(e)));
  }, [biz]);

  const change = (patch) => { setCfg((c) => ({ ...c, ...patch })); setPre(null); };
  const save = async () => {
    const r = await saveTallyConfig({ businessId: biz.id, mapping: cfg.mapping, include: cfg.include });
    setCfg(r);
  };
  const preview = async () => {
    setBusy(true);
    try { await save(); setPre(await tallyPreview(biz.id, from, to)); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const download = async (file) => {
    setBusy(true);
    try { await save(); await downloadTally(biz.id, from, to, file); toast(`${file === 'master' ? 'Master' : 'Voucher'}.xml downloaded`, 'success'); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  if (error || loadError) return <ErrorState message={errText(error || loadError)} onRetry={() => window.location.reload()} />;
  if (loading || (!cfg && !off)) return <LoadingState label="Opening Export to Tally…" />;
  if (off) return <div className="dashboard-container"><PageHeader icon={<FileCode2 size={22} />} title="Export to Tally" /><EnableAccounting what="Export to Tally" message={off} /></div>;
  const errors = pre?.problems.filter((p) => p.level === 'error') ?? [];
  const warnings = pre?.problems.filter((p) => p.level === 'warning') ?? [];

  return (
    <div className="dashboard-container">
      <PageHeader icon={<FileCode2 size={22} />} title="Export to Tally" subtitle="Vouchers, party ledgers and stock items for Tally Prime, from the books." />
      <div className="glass-panel p-4" style={{ display: 'grid', gap: 14 }}>
        <section aria-label="Step 1 period">
          <h4 className="section-title" style={{ marginTop: 0 }}>Step 1 · Period</h4>
          <div style={{ display: 'flex', gap: 10 }}>
            <label className="form-label">From<input className="form-input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPre(null); }} /></label>
            <label className="form-label">To<input className="form-input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPre(null); }} /></label>
          </div>
        </section>
        <section aria-label="Step 2 data">
          <h4 className="section-title" style={{ marginTop: 0 }}>Step 2 · Data</h4>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {INCLUDE.map(([k, l]) => <label key={k}><input type="checkbox" checked={!!cfg.include[k]} onChange={(e) => change({ include: { ...cfg.include, [k]: e.target.checked } })} /> {l}</label>)}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
            <strong style={{ fontSize: '0.8rem' }}>Optional extras</strong>
            {EXTRAS.map(([k, l]) => <label key={k}><input type="checkbox" checked={!!cfg.include[k]} onChange={(e) => change({ include: { ...cfg.include, [k]: e.target.checked } })} /> {l}</label>)}
          </div>
          <label style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={!!cfg.include.screens} onChange={(e) => change({ include: { ...cfg.include, screens: e.target.checked } })} /> Also include what the billing screens saved (bills, purchases, receipts, expenses), not only the books</label>
        </section>
        <section aria-label="Step 3 ledger mapping">
          <h4 className="section-title" style={{ marginTop: 0 }}>Step 3 · Ledger names</h4>
          <p className="field-hint">Type the names as they are in your Tally company. Parties are created under the customer and supplier groups.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
            {LEDGERS.map(([k, l]) => (
              <label key={k} className="form-label">{l}
                <input className="form-input" value={cfg.mapping[k] ?? ''} placeholder={DEFAULT_TALLY_MAPPING[k]} onChange={(e) => change({ mapping: { ...cfg.mapping, [k]: e.target.value } })} />
              </label>
            ))}
          </div>
        </section>
        <section aria-label="Step 4 preview">
          <h4 className="section-title" style={{ marginTop: 0 }}>Step 4 · Preview</h4>
          <button className="btn btn-secondary" disabled={busy} onClick={preview}>Preview counts</button>
          {pre && (
            <div style={{ marginTop: 10 }} data-testid="tally-preview">
              <p style={{ margin: 0 }}><strong>{pre.summary.vouchers}</strong> vouchers · <strong>{pre.summary.parties}</strong> parties · <strong>{pre.summary.items}</strong> items · <strong>{pre.summary.warnings}</strong> warnings · <strong>{pre.summary.errors}</strong> errors</p>
              <p className="field-hint">{Object.entries(pre.summary.byType).map(([t, n]) => `${n} ${t}`).join(' · ') || 'Nothing in this period.'}</p>
              {errors.length > 0 && <ul role="alert" style={{ color: 'var(--danger, #dc2626)' }}>{errors.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
              {warnings.length > 0 && <details><summary>{warnings.length} warning{warnings.length === 1 ? '' : 's'} (do not block)</summary><ul>{warnings.map((p, i) => <li key={i}>{p.message}</li>)}</ul></details>}
            </div>
          )}
        </section>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={busy || !pre || errors.length > 0 || !pre.summary.vouchers} onClick={() => download('master')}>Download Master.xml</button>
          <button className="btn btn-primary" disabled={busy || !pre || errors.length > 0 || !pre.summary.vouchers} onClick={() => download('vouchers')}>Download Voucher.xml</button>
        </div>
        <p className="field-hint">In Tally Prime: Import › Masters (Master.xml) first, then Import › Vouchers (Voucher.xml). Try it on a copy of the company first.</p>
      </div>
    </div>
  );
}
