import { useCallback, useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { TabStrip } from '../../components/ui/Tabs';
import { Checkbox, Field, MoneyInput, Select, TextInput } from '../../components/ui/Field';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { toast } from '../../components/ui/Toast';
import { listBusinesses } from '../../lib/data/accounting';
import {
  assetSchedule,
  deleteAsset,
  fyOf,
  listAssets,
  postDepreciation,
  saveAsset,
  saveAssetOpening,
} from '../../lib/data/filing';
import { localToday } from '../../utils';
import { GRID, dmy, err, fyText, rupees } from '../filing/Itr4Page';

// R4.1: the fixed-asset register. Assets with their cost and the day they were put to use; the depreciation is worked out
// from them every time, never typed: income-tax written-down-value blocks (half rate when used under 180 days, a sale taken
// off the block) for the return, and straight-line Companies Act depreciation for the books.

const TABS = [
  { id: 'register', label: 'Register' },
  { id: 'depreciation', label: 'Depreciation' },
  { id: 'openings', label: 'Opening balances' },
];
const BLANK = { name: '', block: 'PM15', cost: null, putToUse: localToday(), lifeYears: null, note: '' };
const money = (v) => rupees(v);

function Register({ businessId, onChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [sale, setSale] = useState(null);
  const load = useCallback(() => {
    listAssets(businessId).then(setData, (e) => toast(err(e), 'error'));
  }, [businessId]);
  useEffect(load, [load]);
  if (!data) return <LoadingState />;
  const blockName = (code) => data.blocks.find((b) => b.code === code);
  const save = async () => {
    try {
      await saveAsset(
        {
          ...(form.id ? {} : { businessId }),
          name: form.name,
          block: form.block,
          cost: form.cost,
          putToUse: form.putToUse,
          lifeYears: form.lifeYears || null,
          note: form.note,
        },
        form.id,
      );
      toast('Asset saved', 'success');
      setForm(null);
      load();
      onChanged?.();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const saveSale = async () => {
    try {
      await saveAsset({ disposal: { date: sale.date, proceeds: sale.proceeds ?? 0, expenses: sale.expenses ?? 0 } }, sale.id);
      toast('Sale recorded', 'success');
      setSale(null);
      load();
      onChanged?.();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const clearSale = async (a) => {
    try {
      await saveAsset({ disposal: null }, a.id);
      load();
      onChanged?.();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const remove = async (a) => {
    if (!(await confirmAction({ title: `Remove ${a.name}?`, message: 'The edit log keeps what it was.', tone: 'danger', confirmLabel: 'Remove' }))) return;
    try {
      await deleteAsset(a.id);
      load();
      onChanged?.();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <section className="glass-panel p-4" aria-label="Asset register">
      <p className="ui-help">
        Add every asset the business owns for use over more than a year: its cost (with what it took to bring it into use) and the
        day it was first used. Depreciation is worked out from these; you never type it.
      </p>
      {data.data.length === 0 ? (
        <p>No assets yet.</p>
      ) : (
        <table className="ui-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Income-tax block</th>
              <th>Cost</th>
              <th>Put to use</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.data.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>
                  {blockName(a.block)?.name} · {blockName(a.block)?.rate}%
                </td>
                <td>{money(a.cost)}</td>
                <td>{dmy(a.putToUse)}</td>
                <td>
                  {a.disposal ? (
                    <StatusChip tone="neutral">Sold {dmy(a.disposal.date)} for {money(a.disposal.proceeds)}</StatusChip>
                  ) : (
                    <StatusChip tone="success">In use</StatusChip>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setForm({ ...a })}>
                    Edit
                  </button>{' '}
                  {a.disposal ? (
                    <button type="button" className="btn btn-secondary" onClick={() => clearSale(a)}>
                      Undo sale
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={() => setSale({ id: a.id, name: a.name, date: localToday(), proceeds: null, expenses: null })}>
                      Record sale
                    </button>
                  )}{' '}
                  <button type="button" className="btn btn-secondary" onClick={() => remove(a)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sale && (
        <div style={{ marginTop: 16 }} role="group" aria-label={`Sale of ${sale.name}`}>
          <h3 style={{ margin: '0 0 4px' }}>Sale of {sale.name}</h3>
          <div style={GRID}>
            <Field label="Date of sale">
              <TextInput type="date" value={sale.date} onChange={(v) => setSale({ ...sale, date: v })} />
            </Field>
            <Field label="Sale proceeds">
              <MoneyInput value={sale.proceeds} onChange={(v) => setSale({ ...sale, proceeds: v })} />
            </Field>
            <Field label="Cost of selling" help="Brokerage and the like; only used if the sale is a capital gain">
              <MoneyInput value={sale.expenses} onChange={(v) => setSale({ ...sale, expenses: v })} />
            </Field>
          </div>
          <button type="button" className="btn btn-primary" onClick={saveSale}>
            Save the sale
          </button>{' '}
          <button type="button" className="btn btn-secondary" onClick={() => setSale(null)}>
            Cancel
          </button>
        </div>
      )}
      {form ? (
        <div style={{ marginTop: 16 }} role="group" aria-label="Asset details">
          <h3 style={{ margin: '0 0 4px' }}>{form.id ? 'Edit asset' : 'Add an asset'}</h3>
          <div style={GRID}>
            <Field label="Asset name" required>
              <TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            </Field>
            <Field label="Income-tax block" help="Decides the rate on the written-down value">
              <Select
                value={form.block}
                onChange={(v) => setForm({ ...form, block: v })}
                options={data.blocks.map((b) => ({ value: b.code, label: `${b.name} · ${b.rate}% (${b.examples})` }))}
              />
            </Field>
            <Field label="Cost" required help="Purchase price plus what it took to bring it into use">
              <MoneyInput value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
            </Field>
            <Field label="Put to use on" required help="The day it was first used, not the invoice date">
              <TextInput type="date" value={form.putToUse} onChange={(v) => setForm({ ...form, putToUse: v })} />
            </Field>
            <Field label="Useful life (years)" help={`Books only; blank takes ${data.lives[form.block]?.life ?? '–'} years (Schedule II)`}>
              <TextInput value={form.lifeYears ?? ''} onChange={(v) => setForm({ ...form, lifeYears: v ? Number(v) : null })} inputMode="numeric" />
            </Field>
            <Field label="Note">
              <TextInput value={form.note ?? ''} onChange={(v) => setForm({ ...form, note: v })} />
            </Field>
          </div>
          <button type="button" className="btn btn-primary" onClick={save}>
            Save asset
          </button>{' '}
          <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setForm({ ...BLANK })}>
          Add an asset
        </button>
      )}
    </section>
  );
}

function Depreciation({ businessId, fy, refreshKey }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setS(null);
    assetSchedule(businessId, fy).then(setS, setError);
  }, [businessId, fy]);
  useEffect(load, [load, refreshKey]);
  if (error) return <ErrorState error={error} />;
  if (!s) return <LoadingState />;
  const post = async () => {
    setBusy(true);
    try {
      const r = await postDepreciation(businessId, fy);
      setPosted(r);
      toast(r.posted ? `Depreciation of ${money(r.amount)} posted as ${r.number}` : 'Nothing to charge for this year', 'success');
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const rateOf = (code) => s.blocks.find((b) => b.block === code)?.rate;
  return (
    <section className="glass-panel p-4" aria-label="Depreciation">
      <h3 style={{ margin: '0 0 4px' }}>Income tax (for the return)</h3>
      <p className="ui-help">
        Written-down value by block. Additions used for 180 days or more in the year earn the full rate, the rest half. Sale proceeds come
        off the block.
      </p>
      {s.blocks.length === 0 ? (
        <p>No assets or opening balances yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ui-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Block</th>
                <th>Opening</th>
                <th>Added (180+ days)</th>
                <th>Added (under 180)</th>
                <th>Sold</th>
                <th>Depreciation</th>
                <th>Closing</th>
                <th>Gain / loss on sale</th>
              </tr>
            </thead>
            <tbody>
              {s.blocks.map((b) => (
                <tr key={b.block}>
                  <td>
                    {b.block} · {rateOf(b.block)}%
                  </td>
                  <td>{money(b.WDVFirstDay)}</td>
                  <td>{money(b.AdditionsGrThan180Days)}</td>
                  <td>{money(b.AdditionsLessThan180Days)}</td>
                  <td>{money(b.RealizationTotalPeriod + b.RealizationPeriodLessThan180days)}</td>
                  <td>{money(b.NetAggregateDepreciation)}</td>
                  <td>{money(b.WDVLastDay)}</td>
                  <td>{b.CapGainUs50 ? money(b.CapGainUs50) : '–'}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total</b>
                </td>
                <td colSpan={4} />
                <td>
                  <b>{money(s.taxDepreciation)}</b>
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {s.blocks.flatMap((b) => b.notes.map((n) => <p key={b.block + n} role="status">{b.block}: {n}</p>))}
      <h3 style={{ margin: '16px 0 4px' }}>Books (Companies Act, straight line, 5% residual)</h3>
      {s.book.rows.length === 0 ? (
        <p>No assets in use this year.</p>
      ) : (
        <table className="ui-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Charged this year</th>
              <th>Charged to date</th>
              <th>Net block</th>
            </tr>
          </thead>
          <tbody>
            {s.book.rows.map((r) => (
              <tr key={r.asset.id}>
                <td>{r.asset.name}</td>
                <td>{money(r.depreciation)}</td>
                <td>{money(r.accumulated)}</td>
                <td>{money(r.netBlock)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Total</b>
              </td>
              <td>
                <b>{money(s.book.depreciation)}</b>
              </td>
              <td>{money(s.book.accumulated)}</td>
              <td>{money(s.book.netBlock)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="ui-help" style={{ marginTop: 12 }}>
        Post this year&rsquo;s depreciation to the books so the profit and loss account and the balance sheet carry it. One journal per
        year; posting again replaces it. The asset&rsquo;s cost itself must already be in the books (a purchase, or an account opened at cost).
      </p>
      <button type="button" className="btn btn-primary" onClick={post} disabled={busy}>
        {busy ? 'Posting…' : `Post ${money(s.book.depreciation)} to the books`}
      </button>
      {posted?.posted && <p role="status">Posted {posted.number}, dated {dmy(posted.date)}.</p>}
    </section>
  );
}

function Openings({ businessId, fy }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ block: 'PM15', wdv: null, trackedAll: false });
  const load = useCallback(() => {
    listAssets(businessId).then(setData, (e) => toast(err(e), 'error'));
  }, [businessId]);
  useEffect(load, [load]);
  if (!data) return <LoadingState />;
  const save = async () => {
    try {
      await saveAssetOpening({ businessId, fy, block: f.block, wdv: f.wdv ?? 0, trackedAll: f.trackedAll });
      toast('Opening balance saved', 'success');
      load();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <section className="glass-panel p-4" aria-label="Opening balances">
      <p className="ui-help">
        For assets bought before you started using the register: the written-down value of the block on 1 April of the year you start. Find
        it in last year&rsquo;s return (Schedule DPM or DOA, the value on the last day) or from your CA.
      </p>
      {data.openings.length > 0 && (
        <table className="ui-table" style={{ width: '100%', maxWidth: 520 }}>
          <thead>
            <tr>
              <th>Year</th>
              <th>Block</th>
              <th>Written-down value</th>
            </tr>
          </thead>
          <tbody>
            {data.openings.map((o) => (
              <tr key={`${o.fy}${o.block}`}>
                <td>FY {o.fy}</td>
                <td>{o.block}</td>
                <td>{money(o.wdv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={GRID}>
        <Field label={`Block on 1 April ${fy.slice(0, 4)}`}>
          <Select value={f.block} onChange={(v) => setF({ ...f, block: v })} options={data.blocks.map((b) => ({ value: b.code, label: `${b.name} · ${b.rate}%` }))} />
        </Field>
        <Field label="Written-down value">
          <MoneyInput value={f.wdv} onChange={(v) => setF({ ...f, wdv: v })} />
        </Field>
      </div>
      <Checkbox
        checked={f.trackedAll}
        onChange={(v) => setF({ ...f, trackedAll: v })}
        label="Every asset behind this balance is in the register (so selling them all ends the block)"
      />
      <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>
        Save opening balance
      </button>
    </section>
  );
}

export default function AssetsPage() {
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [fy, setFy] = useState(() => fyText(Math.max(2024, Math.min(2026, fyOf(localToday())))));
  const [tab, setTab] = useState('register');
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState(null);
  useEffect(() => {
    listBusinesses().then((list) => {
      setBusinesses(list);
      setBusinessId((list.find((b) => b.isDefault) || list[0])?.id ?? '');
    }, setError);
  }, []);
  if (error) return <ErrorState error={error} />;
  if (!businesses) return <LoadingState />;
  const y = Number(fy.slice(0, 4));
  return (
    <div className="dashboard-container">
      <PageHeader
        icon={<Landmark size={22} />}
        title="Fixed Assets"
        subtitle="Assets, their depreciation for the return and for the books"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              value={fy}
              onChange={setFy}
              aria-label="Financial year"
              options={[y - 2, y - 1, y, y + 1].filter((v) => v >= 2020 && v <= 2027).map((v) => ({ value: fyText(v), label: `FY ${fyText(v)}` }))}
            />
          </div>
        }
      />
      <TabStrip tabs={TABS} value={tab} onChange={setTab} ariaLabel="Fixed asset steps" />
      <div style={{ marginTop: 12 }}>
        {!businessId ? (
          <p>Create a business first.</p>
        ) : (
          <>
            {tab === 'register' && <Register businessId={businessId} onChanged={() => setRefreshKey((k) => k + 1)} />}
            {tab === 'depreciation' && <Depreciation businessId={businessId} fy={fy} refreshKey={refreshKey} />}
            {tab === 'openings' && <Openings businessId={businessId} fy={fy} />}
          </>
        )}
      </div>
    </div>
  );
}
