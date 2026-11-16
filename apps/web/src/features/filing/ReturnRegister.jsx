import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipboardList } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { listBusinesses } from '../../lib/data/accounting';
import { buildCmp08, buildGst, buildGstr4, buildGstr9, buildGstr9c, filingCalendar, fyOf, KIND_LABELS, listPacks, periodLabel, savePack, setTrackFrom, STATUS_TONES } from '../../lib/data/filing';
import { promptAction } from '../../components/ui/ConfirmModal';
import { toast } from '../../components/ui/Toast';
import { useEntitlements } from '../billing/useEntitlements';
import { localToday } from '../../utils';

// File-ready returns: the Return Register. Every GST return of the financial year with its due date, the pack the app
// prepared for it, where that pack stands (needs fixes, with the CA, approved, filed) and what is overdue. A row opens
// its pack; a return with no pack links to the GST Returns screen that prepares it.

const err = (e) => e?.message || 'Something went wrong';
const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '–');
const PREPARE = { gstr1: '/gst-returns/gstr1', gstr3b: '/gst-returns/gstr3b', ims: '/gst-returns/gstr2b' };

function Status({ status, overdue }) {
  const [tone, label] = STATUS_TONES[status] ?? ['neutral', status];
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      <StatusChip tone={tone}>{label}</StatusChip>
      {overdue && <StatusChip tone="danger" outline>Overdue</StatusChip>}
    </span>
  );
}

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const monthLabel = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');

export default function ReturnRegister() {
  const { can } = useEntitlements();
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [fy, setFy] = useState(() => fyOf(localToday()));
  const [cal, setCal] = useState(null);
  const [others, setOthers] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    listBusinesses().then(
      (list) => {
        setBusinesses(list);
        setBusinessId((list.find((b) => b.isDefault) || list[0])?.id ?? '');
      },
      setError,
    );
  }, []);
  const load = useCallback(() => {
    if (!businessId) return;
    setCal(null);
    setError(null);
    Promise.all([filingCalendar(businessId, fy), listPacks({ businessId, fy, kind: 'ims' })]).then(
      ([c, ims]) => { setCal(c); setOthers(ims); },
      setError,
    );
  }, [businessId, fy]);
  useEffect(() => { load(); }, [load]);

  // Returns before this month are listed but never counted as overdue (they were most likely filed elsewhere).
  const navigate = useNavigate();
  const [building, setBuilding] = useState('');
  // R1: returns the server works out. GSTR-9 from the year's filed months; CMP-08 from the quarter's turnover.
  const buildAndSave = async (key, build) => {
    setBuilding(key);
    try {
      const b = await build();
      const pack = await savePack({ businessId, kind: b.kind, period: b.period, quarterly: b.kind === 'cmp08' || !!b.quarterly, payload: b.payload });
      navigate(`/filing/${pack.id}`);
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBuilding('');
    }
  };
  const prepareGstr9 = () => buildAndSave('gstr9', () => buildGstr9(businessId, fy));
  // X1: GSTR-1 / GSTR-3B built on the server from the books, the same code as the GST Returns screen.
  const prepareGst = (row) => buildAndSave(`${row.kind}:${row.period}`, () => buildGst(businessId, row.kind, row.period, row.quarterly));
  const prepareGstr4 = () => buildAndSave('gstr4', () => buildGstr4(businessId, fy));
  // GSTR-9C: the books against GSTR-9. Adjustments explain why the books' turnover differs ("Unbilled revenue = -5000").
  const prepareGstr9c = async () => {
    const v = await promptAction({
      title: `GSTR-9C · FY ${fy}-${String(fy + 1).slice(2)}`,
      message: 'Adjustments to the books’ turnover, if any, as “reason = amount; reason = amount” (negative to subtract). Leave empty for none.',
      defaultValue: '',
      confirmLabel: 'Prepare',
    });
    if (v === null || v === undefined) return;
    const adjustments = [];
    for (const part of String(v).split(';').map((x) => x.trim()).filter(Boolean)) {
      const m = /^(.+?)\s*=\s*(-?[\d,.]+)$/.exec(part);
      if (!m) { toast(`Could not read “${part}”: use reason = amount`, 'warning'); return; }
      adjustments.push({ label: m[1].trim(), amount: Number(m[2].replace(/,/g, '')) });
    }
    buildAndSave('gstr9c', () => buildGstr9c(businessId, fy, adjustments));
  };
  const prepareCmp08 = async (row) => {
    const v = await promptAction({
      title: `CMP-08 · ${periodLabel(row.period, true)}`,
      message: 'Turnover of the quarter: your outward supplies on Bills of Supply, exempt supplies left out (Reports › Sale for the three months)',
      defaultValue: '',
      confirmLabel: 'Prepare',
    });
    if (v === null || v === undefined || String(v).trim() === '') return;
    const turnover = Number(String(v).replace(/[,₹\s]/g, ''));
    if (!(turnover >= 0)) { toast('Enter the turnover as a number', 'warning'); return; }
    buildAndSave(row.period, () => buildCmp08(businessId, row.period, turnover));
  };

  const changeTrackFrom = async () => {
    const v = await promptAction({
      title: 'Track returns from',
      message: 'The first month whose returns this register checks for overdue, as YYYY-MM (for example the month you moved your books here). Leave empty for the default.',
      defaultValue: cal?.trackedFrom ?? '',
      confirmLabel: 'Save',
    });
    if (v === null || v === undefined) return;
    const month = String(v).trim() || null;
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { toast('Use YYYY-MM, for example 2026-04', 'warning'); return; }
    try { await setTrackFrom(businessId, month); load(); } catch (e) { toast(err(e), 'error'); }
  };

  const counts = useMemo(() => {
    const rows = cal?.rows ?? [];
    return {
      filed: rows.filter((r) => r.status === 'filed').length,
      review: rows.filter((r) => r.status === 'in_review').length,
      changes: rows.filter((r) => r.status === 'changes_requested' || r.status === 'draft').length,
      overdue: rows.filter((r) => r.overdue).length,
    };
  }, [cal]);

  const header = (
    <PageHeader
      icon={<ClipboardList size={22} />}
      title="Return Register"
      subtitle="Every return of the year, ready to upload, with the CA's review and the ARN once filed"
      actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {businesses?.length > 1 && (
            <select className="ui-select" aria-label="Business" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select className="ui-select" aria-label="Financial year" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {[0, 1, 2, 3].map((k) => {
              const y = fyOf(localToday()) - k;
              return <option key={y} value={y}>FY {y}-{String(y + 1).slice(2)}</option>;
            })}
          </select>
          {can('filing:prepare') && cal?.regType !== 'composition' && (
            <>
              <button type="button" className="btn btn-secondary" disabled={!!building || !businessId} onClick={prepareGstr9} title="The annual return, worked out from this year's filed GSTR-1 and GSTR-3B">
                {building === 'gstr9' ? 'Preparing…' : `Prepare GSTR-9 (FY ${fy}-${String(fy + 1).slice(2)})`}
              </button>
              <button type="button" className="btn btn-secondary" disabled={!!building || !businessId} onClick={prepareGstr9c} title="Reconcile the year's books with GSTR-9 (self-certified)">
                {building === 'gstr9c' ? 'Preparing…' : 'Prepare GSTR-9C'}
              </button>
            </>
          )}
        </div>
      }
    />
  );

  if (error) return <div className="dashboard-container">{header}<ErrorState message={err(error)} onRetry={load} /></div>;
  if (!businesses || (businessId && !cal)) return <div className="dashboard-container">{header}<LoadingState label="Loading the register…" /></div>;
  if (!businessId) return <div className="dashboard-container">{header}<EmptyState title="No business yet" hint="Set up your business first." /></div>;
  if (!cal.gstin)
    return (
      <div className="dashboard-container">
        {header}
        <EmptyState title="Add your GSTIN" hint="Returns are prepared for a GST registration. Add the GSTIN in Settings › Business." action={<Link className="btn btn-primary" to="/settings/business">Open business settings</Link>} />
      </div>
    );

  return (
    <div className="dashboard-container">
      {header}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }} aria-label="Summary">
        <StatusChip tone="success">{counts.filed} filed</StatusChip>
        <StatusChip tone="warn">{counts.review} with the CA</StatusChip>
        <StatusChip tone="danger">{counts.changes} need fixes</StatusChip>
        <StatusChip tone={counts.overdue ? 'danger' : 'neutral'} outline>{counts.overdue} overdue</StatusChip>
        <span className="ui-help" style={{ marginLeft: 'auto' }}>
          {cal.regType === 'composition' ? 'Composition' : cal.frequency === 'qrmp' ? 'Quarterly (QRMP)' : 'Monthly'} filer · GSTIN {cal.gstin} · tracking from {monthLabel(cal.trackedFrom)}
          {can('filing:prepare') && (
            <>
              {' '}
              <button type="button" className="btn-link" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer' }} onClick={changeTrackFrom}>
                Change
              </button>
            </>
          )}
        </span>
      </div>

      <div className="ui-table-wrap" style={{ overflowX: 'auto' }}>
        <table className="ui-table" style={{ width: '100%', minWidth: 640 }}>
          <thead>
            <tr>
              <th>Return</th>
              <th>Due</th>
              <th>Status</th>
              <th>ARN / filed on</th>
              <th aria-label="Action" />
            </tr>
          </thead>
          <tbody>
            {cal.rows.map((r) => (
              <tr key={`${r.form}:${r.month}`} style={r.overdue ? { background: 'rgba(220,38,38,0.05)' } : undefined}>
                <td>{r.label}</td>
                <td>{dmy(r.due)}</td>
                <td>
                  {r.kind && r.beforeTracking && r.status === 'not_started' ? (
                    <span className="ui-help">Before you started</span>
                  ) : r.kind ? (
                    <>
                      <Status status={r.status} overdue={r.overdue} />
                      {r.lateFee?.fee > 0 && <div className="ui-help" title={`${r.lateFee.days} days late; capped at ₹${r.lateFee.cap}. Interest at 18% a year is extra on tax paid late in cash.`}>Late fee about ₹{r.lateFee.fee}</div>}
                    </>
                  ) : (
                    <span className="ui-help">{r.optional ? 'Optional' : 'Pay or file on the portal'}</span>
                  )}
                </td>
                <td>{r.arn ? <><code>{r.arn}</code><br /><span className="ui-help">{dmy(r.filedOn)}</span></> : '–'}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.packId ? (
                    <Link className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} to={`/filing/${r.packId}`}>Open</Link>
                  ) : r.kind ? (
                    r.kind === 'gstr1' || r.kind === 'gstr3b' ? (
                      <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} disabled={!!building || !can('filing:prepare')} onClick={() => prepareGst(r)} title="Build it from your books on the server">
                        {building === `${r.kind}:${r.period}` ? 'Preparing…' : 'Prepare'}
                      </button>
                    ) : r.kind === 'gstr4' ? (
                      <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} disabled={!!building || !can('filing:prepare')} onClick={prepareGstr4}>
                        {building === 'gstr4' ? 'Preparing…' : 'Prepare'}
                      </button>
                    ) : r.kind === 'cmp08' ? (
                      <button type="button" className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} disabled={!!building || !can('filing:prepare')} onClick={() => prepareCmp08(r)}>
                        {building === r.period ? 'Preparing…' : 'Prepare'}
                      </button>
                    ) : (
                      <Link className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} to={PREPARE[r.kind]}>Prepare</Link>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-title" style={{ marginTop: 20 }}>IMS action lists</h3>
      {others.length === 0 ? (
        <p className="ui-help">None yet. Import GSTR-2B on the GST Returns screen, then press “IMS action list”.</p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {others.map((p) => (
            <li key={p.id} style={{ marginBottom: 4 }}>
              <Link to={`/filing/${p.id}`}>{KIND_LABELS[p.kind]} · {periodLabel(p.period, p.quarterly)} · v{p.version}</Link>{' '}
              <Status status={p.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
