import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Calculator } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { TabStrip } from '../../components/ui/Tabs';
import { Checkbox, Field, MoneyInput, Select, TextInput } from '../../components/ui/Field';
import { listBusinesses } from '../../lib/data/accounting';
import {
  addChallan,
  advanceTax,
  buildItr4,
  deleteAis,
  deleteChallan,
  fyOf,
  getItrDraft,
  getTaxpayer,
  incomeTaxCalendar,
  itrBooks,
  listAis,
  listChallans,
  previewAis,
  reconcileAisApi,
  saveAis,
  saveItrDraft,
  savePack,
  saveTaxpayer,
} from '../../lib/data/filing';
import { toast } from '../../components/ui/Toast';
import { localToday } from '../../utils';

// R2 income tax: the ITR-4 (Sugam) return for a proprietor on presumptive income. The taxpayer's details, what the return
// needs beyond the books, the challans and advance tax, the AIS / TIS match, and the file itself. The app never files:
// the file is saved as a pack, reviewed, and the person uploads it on the income-tax portal.

const err = (e) => e?.message || 'Something went wrong';
const rupees = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '–');
const fyText = (y) => `${y}-${String(y + 1).slice(2)}`;
const TABS = [
  { id: 'taxpayer', label: 'Taxpayer' },
  { id: 'return', label: 'Return' },
  { id: 'tax', label: 'Challans & advance tax' },
  { id: 'ais', label: 'AIS / TIS' },
  { id: 'build', label: 'Build the file' },
];
const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '0 16px',
};
const PARTICULARS = [
  ['partnerMemberOwnCapital', 'Proprietor’s capital'],
  ['securedLoans', 'Secured loans'],
  ['unsecuredLoans', 'Unsecured loans'],
  ['sundryCreditors', 'Sundry creditors'],
  ['othrCurrLiab', 'Other current liabilities'],
  ['fixedAssets', 'Fixed assets'],
  ['inventories', 'Inventories (stock)'],
  ['sundryDebtors', 'Sundry debtors'],
  ['balWithBanks', 'Balance with banks'],
  ['cashInHand', 'Cash in hand'],
  ['loansAndAdvances', 'Loans and advances'],
  ['otherAssets', 'Other assets'],
];
const BLANK_BANK = { ifsc: '', bankName: '', accountNo: '', accountType: 'SB', useForRefund: true };

function Taxpayer({ businessId }) {
  const [form, setForm] = useState(null);
  const [warn, setWarn] = useState([]);
  useEffect(() => {
    getTaxpayer(businessId)
      .then((p) =>
        setForm({
          pan: '',
          firstName: '',
          middleName: '',
          surname: '',
          fatherName: '',
          dob: '',
          residenceNo: '',
          residenceName: '',
          roadOrStreet: '',
          locality: '',
          city: '',
          stateCode: '33',
          pinCode: '',
          mobile: '',
          email: '',
          employerCategory: 'NA',
          place: '',
          bankAccounts: [{ ...BLANK_BANK }],
          form10Iea: null,
          ...(p ?? {}),
          aadhaar: '',
        }),
      )
      .catch((e) => toast(err(e), 'error'));
  }, [businessId]);
  if (!form) return <LoadingState />;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k, label, props = {}) => (
    <Field label={label} required={props.required}>
      <TextInput value={form[k]} onChange={set(k)} {...props} />
    </Field>
  );
  const setBank = (i, patch) =>
    setForm((f) => ({
      ...f,
      bankAccounts: f.bankAccounts.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));
  const save = async () => {
    try {
      const body = {
        ...form,
        businessId,
        bankAccounts: form.bankAccounts.map(({ accountNoMasked, ...b }) => b),
      };
      const r = await saveTaxpayer(body);
      setWarn(r.warnings);
      toast('Taxpayer details saved', 'success');
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <section className="glass-panel p-4" aria-label="Taxpayer details">
      <div style={GRID}>
        {text('pan', 'PAN', { required: true, maxLength: 10 })}
        {text('dob', 'Date of birth', { type: 'date', required: true })}
        {text('firstName', 'First name')}
        {text('surname', 'Surname (or full name)', { required: true })}
        {text('fatherName', 'Father’s name', { required: true })}
        {text('place', 'Place of signing')}
        {text('residenceNo', 'Flat / door no.')}
        {text('locality', 'Area / locality')}
        {text('city', 'Town / city')}
        {text('stateCode', 'State code (e.g. 33)', { maxLength: 2 })}
        {text('pinCode', 'PIN code', { maxLength: 6 })}
        {text('mobile', 'Mobile', { maxLength: 10 })}
        {text('email', 'Email')}
        <Field
          label="Aadhaar"
          help={
            form.hasAadhaar
              ? `Saved (${form.aadhaarMasked}). Leave blank to keep it.`
              : 'Optional, 12 digits. Stored encrypted.'
          }
        >
          <TextInput value={form.aadhaar} onChange={set('aadhaar')} maxLength={12} />
        </Field>
        <Field label="Employer category" help="NA unless you also have salary income">
          <Select
            value={form.employerCategory}
            onChange={set('employerCategory')}
            options={['NA', 'CGOV', 'SGOV', 'PSU', 'PE', 'PESG', 'PEPS', 'PEO', 'OTH']}
          />
        </Field>
      </div>
      <h3 style={{ margin: '16px 0 4px' }}>Bank accounts</h3>
      <p className="ui-help">
        The portal needs at least one account. Account numbers are stored encrypted and shown only
        by their last four digits.
      </p>
      {form.bankAccounts.map((b, i) => (
        <div key={b.id ?? i} style={GRID} style={{ marginBottom: 8 }}>
          <Field label="IFSC">
            <TextInput
              value={b.ifsc}
              onChange={(v) => setBank(i, { ifsc: v.toUpperCase() })}
              maxLength={11}
            />
          </Field>
          <Field label="Bank name">
            <TextInput value={b.bankName} onChange={(v) => setBank(i, { bankName: v })} />
          </Field>
          <Field
            label="Account number"
            help={
              b.accountNoMasked
                ? `Saved (${b.accountNoMasked}). Leave blank to keep it.`
                : undefined
            }
          >
            <TextInput value={b.accountNo ?? ''} onChange={(v) => setBank(i, { accountNo: v })} />
          </Field>
          <Checkbox
            checked={b.useForRefund}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                bankAccounts: f.bankAccounts.map((x, j) => ({
                  ...x,
                  useForRefund: j === i ? v : false,
                })),
              }))
            }
            label="Refund to this account"
          />
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          setForm((f) => ({
            ...f,
            bankAccounts: [...f.bankAccounts, { ...BLANK_BANK, useForRefund: false }],
          }))
        }
      >
        Add account
      </button>
      <h3 style={{ margin: '16px 0 4px' }}>Form 10-IEA (only to use the older regime)</h3>
      <div style={GRID}>
        <Field label="Acknowledgement number (15 digits)">
          <TextInput
            value={form.form10Iea?.ack ?? ''}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                form10Iea:
                  v || f.form10Iea?.filedOn
                    ? { ack: v, filedOn: f.form10Iea?.filedOn ?? '' }
                    : null,
              }))
            }
            maxLength={15}
          />
        </Field>
        <Field label="Filed on">
          <TextInput
            type="date"
            value={form.form10Iea?.filedOn ?? ''}
            onChange={(v) =>
              setForm((f) => ({ ...f, form10Iea: { ack: f.form10Iea?.ack ?? '', filedOn: v } }))
            }
          />
        </Field>
      </div>
      {warn.map((w) => (
        <p key={w} className="ui-help" role="status">
          ⚠ {w}
        </p>
      ))}
      <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>
        Save taxpayer details
      </button>
    </section>
  );
}

function ReturnInputs({ businessId, fy }) {
  const [d, setD] = useState(null);
  const [books, setBooks] = useState(null);
  useEffect(() => {
    Promise.all([getItrDraft(businessId, fy), itrBooks(businessId, fy)]).then(
      ([r, b]) => {
        setD(r.data);
        setBooks(b);
      },
      (e) => toast(err(e), 'error'),
    );
  }, [businessId, fy]);
  if (!d || !books) return <LoadingState />;
  const biz = d.business ?? {
    section: '44AD',
    code: '',
    name: '',
    description: '',
    digitalReceipts: 0,
    cashReceipts: 0,
  };
  const setBiz = (patch) => setD((x) => ({ ...x, business: { ...biz, ...patch } }));
  const setOs = (patch) => setD((x) => ({ ...x, otherSources: { ...x.otherSources, ...patch } }));
  const setDecl = (k) => (v) =>
    setD((x) => ({ ...x, declarations: { ...x.declarations, [k]: v } }));
  const save = async () => {
    try {
      await saveItrDraft(businessId, fy, d);
      toast('Saved', 'success');
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const fromBooks = () =>
    setBiz({ digitalReceipts: books.digitalReceipts, cashReceipts: books.cashReceipts });
  const DECL = [
    ['houseProperty', 'Income from house property'],
    ['capitalGains', 'Capital gains'],
    ['foreignAssetsOrIncome', 'Foreign assets or foreign income'],
    ['companyDirector', 'Director of a company'],
    ['unlistedShares', 'Unlisted equity shares'],
    ['carriedForwardLoss', 'Losses carried forward'],
    ['agriculturalIncomeOver5000', 'Agricultural income over ₹5,000'],
    ['section44AE', 'Goods carriage income under 44AE'],
  ];
  return (
    <section className="glass-panel p-4" aria-label="Return inputs">
      <p className="ui-help">
        Your books for FY {fy}: turnover {rupees(books.turnover)}, of which {books.digitalShare}%
        was received by bank or UPI. Use these figures, or type your own.
      </p>
      <div style={GRID}>
        <Field label="Tax regime">
          <Select
            value={d.regime}
            onChange={(v) => setD({ ...d, regime: v })}
            options={[
              { value: 'new', label: 'New regime (default)' },
              { value: 'old', label: 'Older regime (needs Form 10-IEA)' },
            ]}
          />
        </Field>
        <Field label="Scheme">
          <Select
            value={biz.section}
            onChange={(v) => setBiz({ section: v })}
            options={[
              { value: '44AD', label: '44AD · business (6% digital / 8% cash)' },
              { value: '44ADA', label: '44ADA · profession (50%)' },
            ]}
          />
        </Field>
        <Field label="Business code">
          <TextInput value={biz.code} onChange={(v) => setBiz({ code: v })} maxLength={5} />
        </Field>
        <Field label="Business name">
          <TextInput value={biz.name} onChange={(v) => setBiz({ name: v })} />
        </Field>
        <Field label="Receipts by bank / UPI">
          <MoneyInput
            value={biz.digitalReceipts}
            onChange={(v) => setBiz({ digitalReceipts: v ?? 0 })}
          />
        </Field>
        <Field label="Receipts in cash">
          <MoneyInput value={biz.cashReceipts} onChange={(v) => setBiz({ cashReceipts: v ?? 0 })} />
        </Field>
      </div>
      <button type="button" className="btn btn-secondary" onClick={fromBooks}>
        Use the books’ figures
      </button>
      <h3 style={{ margin: '16px 0 4px' }}>Financial particulars on 31 March</h3>
      <p className="ui-help">
        The department asks for these even under the presumptive scheme: what the business owed,
        owned and was owed on the last day of the year. Leave a figure at zero if it does not apply.
      </p>
      <div style={GRID}>
        {PARTICULARS.map(([k, label]) => (
          <Field key={k} label={label}>
            <MoneyInput
              value={biz.particulars?.[k] ?? 0}
              onChange={(v) => setBiz({ particulars: { ...biz.particulars, [k]: v ?? 0 } })}
            />
          </Field>
        ))}
      </div>
      <h3 style={{ margin: '16px 0 4px' }}>Other income</h3>
      <div style={GRID}>
        <Field
          label="Savings-account interest"
          help={books.interestSavings ? `Books: ${rupees(books.interestSavings)}` : undefined}
        >
          <MoneyInput
            value={d.otherSources.savingsInterest}
            onChange={(v) => setOs({ savingsInterest: v ?? 0 })}
          />
        </Field>
        <Field
          label="Deposit interest"
          help={books.interestDeposits ? `Books: ${rupees(books.interestDeposits)}` : undefined}
        >
          <MoneyInput
            value={d.otherSources.depositInterest}
            onChange={(v) => setOs({ depositInterest: v ?? 0 })}
          />
        </Field>
      </div>
      <h3 style={{ margin: '16px 0 4px' }}>Not possible in ITR-4</h3>
      <p className="ui-help">
        Tick whatever applies to you. If any of these apply, ITR-4 can not be used and the file is
        not built.
      </p>
      {DECL.map(([k, label]) => (
        <Checkbox key={k} checked={!!d.declarations[k]} onChange={setDecl(k)} label={label} />
      ))}
      {books.tdsFromBooks.length > 0 && (
        <p className="ui-help" style={{ marginTop: 12 }}>
          TDS customers deducted, from your receipts:{' '}
          {books.tdsFromBooks.map((t) => `${t.deductor} ${rupees(t.tds)}`).join(', ')}. Enter each
          deductor with its TAN on Form 26AS under TDS when you have it.
        </p>
      )}
      <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>
        Save
      </button>
    </section>
  );
}

function TaxPayments({ businessId, fy }) {
  const [rows, setRows] = useState(null);
  const [plan, setPlan] = useState(null);
  const [f, setF] = useState({ bsr: '', date: localToday(), serial: '', amount: null });
  const load = useCallback(() => {
    Promise.all([listChallans(businessId, fy), advanceTax(businessId, fy)]).then(
      ([c, p]) => {
        setRows(c);
        setPlan(p);
      },
      (e) => toast(err(e), 'error'),
    );
  }, [businessId, fy]);
  useEffect(load, [load]);
  if (!rows || !plan) return <LoadingState />;
  const add = async () => {
    try {
      await addChallan({
        businessId,
        fy,
        bsr: f.bsr,
        date: f.date,
        serial: Number(f.serial),
        amount: f.amount,
      });
      setF({ bsr: '', date: localToday(), serial: '', amount: null });
      load();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  return (
    <>
      <section className="glass-panel p-4" aria-labelledby="adv-h">
        <h2 id="adv-h" style={{ marginTop: 0 }}>
          Advance tax · FY {fy}
        </h2>
        {!plan.applies ? (
          <p>{plan.note ?? 'No advance tax is due: your tax after TDS is under ₹10,000.'}</p>
        ) : (
          <>
            <p>
              Tax for the year about <b>{rupees(plan.projectedTax)}</b> (
              {plan.basis.receiptsFrom === 'return'
                ? 'from your return’s entries'
                : 'from your books'}
              {plan.basis.annualised ? ', scaled to a full year' : ''}).
              {plan.payNow > 0 ? (
                <>
                  {' '}
                  Pay <b>{rupees(plan.payNow)}</b> now.
                </>
              ) : (
                ' Nothing is due right now.'
              )}
              {plan.interest234C > 0 && (
                <> Interest if nothing more is paid: {rupees(plan.interest234C)} (234C).</>
              )}
            </p>
            <table className="ui-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Cumulative</th>
                  <th>Paid by then</th>
                  <th>Short</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.dueDate}>
                    <td>{dmy(r.dueDate)}</td>
                    <td>{rupees(r.cumulativeDue)}</td>
                    <td>{rupees(r.paidByDate)}</td>
                    <td>{rupees(r.shortfall)}</td>
                    <td>
                      <StatusChip
                        tone={
                          r.status === 'paid'
                            ? 'success'
                            : r.status === 'overdue'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {r.status}
                      </StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.basis.profileMissing && (
              <p className="ui-help">
                Add the taxpayer’s date of birth on the Taxpayer tab for an exact figure.
              </p>
            )}
          </>
        )}
      </section>
      <section className="glass-panel p-4 mt-4" aria-labelledby="ch-h">
        <h2 id="ch-h" style={{ marginTop: 0 }}>
          Challans paid
        </h2>
        <p className="ui-help">
          Pay on the e-Pay Tax page of the portal, then enter the challan here. A challan dated up
          to 31 March is advance tax, after it self-assessment tax.
        </p>
        {rows.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <table className="ui-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>BSR</th>
                <th>Serial</th>
                <th>Amount</th>
                <th>Kind</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{dmy(c.date)}</td>
                  <td>{c.bsr}</td>
                  <td>{c.serial}</td>
                  <td>{rupees(c.amount)}</td>
                  <td>{c.kind === 'advance' ? 'Advance tax' : 'Self-assessment'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={async () => {
                        try {
                          await deleteChallan(c.id);
                          load();
                        } catch (e) {
                          toast(err(e), 'error');
                        }
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={GRID} style={{ marginTop: 12 }}>
          <Field label="BSR code (7)">
            <TextInput
              value={f.bsr}
              onChange={(v) => setF({ ...f, bsr: v.toUpperCase() })}
              maxLength={7}
            />
          </Field>
          <Field label="Date of deposit">
            <TextInput type="date" value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          </Field>
          <Field label="Challan serial no.">
            <TextInput
              value={f.serial}
              onChange={(v) => setF({ ...f, serial: v.replace(/\D/g, '') })}
              maxLength={5}
            />
          </Field>
          <Field label="Amount">
            <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={add}
          disabled={!f.bsr || !f.serial || !f.amount}
        >
          Add challan
        </button>
      </section>
    </>
  );
}

function Ais({ businessId, fy }) {
  const [files, setFiles] = useState(null);
  const [rec, setRec] = useState(null);
  const [preview, setPreview] = useState(null);
  const load = useCallback(() => {
    Promise.all([listAis(businessId, fy), reconcileAisApi(businessId, fy)]).then(
      ([l, r]) => {
        setFiles(l);
        setRec(r);
      },
      (e) => toast(err(e), 'error'),
    );
  }, [businessId, fy]);
  useEffect(load, [load]);
  if (!files) return <LoadingState />;
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const p = await previewAis(await file.text());
      setPreview({ ...p, fileName: file.name });
    } catch (x) {
      toast(err(x), 'error');
    }
    e.target.value = '';
  };
  const confirm = async (kind) => {
    try {
      await saveAis({ businessId, fy, kind, fileName: preview.fileName, rows: preview.rows });
      setPreview(null);
      load();
      toast('Imported', 'success');
    } catch (x) {
      toast(err(x), 'error');
    }
  };
  return (
    <section className="glass-panel p-4" aria-label="AIS and TIS">
      <p className="ui-help">
        Download your AIS or TIS from the income-tax portal (CSV or JSON) and read it in here. This
        is a beta: the portal publishes no fixed format, so check what was understood before you
        confirm.
      </p>
      <input type="file" accept=".csv,.json,.txt" onChange={pick} aria-label="AIS or TIS file" />
      {preview && (
        <div style={{ marginTop: 12 }}>
          <p>
            <b>{preview.rows.length}</b> rows understood from {preview.fileName}; {preview.skipped}{' '}
            skipped.
          </p>
          {preview.errors.map((m) => (
            <p key={m} role="alert" className="ui-error">
              {m}
            </p>
          ))}
          {preview.rows.length > 0 && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => confirm('ais')}>
                Save as AIS
              </button>{' '}
              <button type="button" className="btn btn-secondary" onClick={() => confirm('tis')}>
                Save as TIS
              </button>{' '}
            </>
          )}
          <button type="button" className="btn btn-link" onClick={() => setPreview(null)}>
            Cancel
          </button>
        </div>
      )}
      {files.map((x) => (
        <p key={x.id}>
          {x.kind.toUpperCase()} · {x.fileName || 'file'} · {x.rows} rows{' '}
          <button
            type="button"
            className="btn btn-link"
            onClick={async () => {
              await deleteAis(x.id);
              load();
            }}
          >
            Remove
          </button>
        </p>
      ))}
      {rec?.imported && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: '0 0 4px' }}>What differs</h3>
          {rec.issues.length === 0 ? (
            <p>AIS agrees with your books and return.</p>
          ) : (
            <ul>
              {rec.issues.map((i) => (
                <li key={i.id}>
                  <StatusChip tone={i.severity === 'error' ? 'danger' : 'warning'}>
                    {i.severity}
                  </StatusChip>{' '}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Build({ businessId, fy }) {
  const navigate = useNavigate();
  const [filedOn, setFiledOn] = useState(localToday());
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setRes(await buildItr4(businessId, fy, filedOn));
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    try {
      const pack = await savePack({
        businessId,
        kind: 'itr4',
        period: res.period,
        payload: res.payload,
      });
      navigate(`/filing/${pack.id}`);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const c = res?.computation;
  return (
    <section className="glass-panel p-4" aria-label="Build the file">
      <p className="ui-help">
        The date you plan to file on decides the late fee and the filing section, so use the real
        date. The file is checked against the department’s own rules and format before you can save
        it.
      </p>
      <div style={GRID}>
        <Field label="Planned filing date">
          <TextInput type="date" value={filedOn} onChange={setFiledOn} />
        </Field>
      </div>
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
        {busy ? 'Building…' : 'Build the ITR-4 file'}
      </button>
      {res && (
        <div style={{ marginTop: 16 }}>
          {res.issues.map((i) => (
            <p key={i.id} role={i.severity === 'error' ? 'alert' : 'status'}>
              <StatusChip tone={i.severity === 'error' ? 'danger' : 'warning'}>
                {i.severity}
              </StatusChip>{' '}
              {i.message}
            </p>
          ))}
          {c && (
            <table className="ui-table" style={{ width: '100%', maxWidth: 480 }}>
              <tbody>
                <tr>
                  <td>Business income</td>
                  <td>{rupees(c.businessIncome)}</td>
                </tr>
                <tr>
                  <td>Total income</td>
                  <td>{rupees(c.totalIncome)}</td>
                </tr>
                <tr>
                  <td>Tax with cess</td>
                  <td>{rupees(c.netTaxLiability)}</td>
                </tr>
                <tr>
                  <td>Paid (TDS, advance, self-assessment)</td>
                  <td>
                    {rupees(c.tdsTotal + c.tcsTotal + c.advanceTaxPaid + c.selfAssessmentTaxPaid)}
                  </td>
                </tr>
                {c.fee234F > 0 && (
                  <tr>
                    <td>Late fee 234F</td>
                    <td>{rupees(c.fee234F)}</td>
                  </tr>
                )}
                <tr>
                  <td>
                    <b>{c.refundDue > 0 ? 'Refund' : 'Tax to pay'}</b>
                  </td>
                  <td>
                    <b>{rupees(c.refundDue > 0 ? c.refundDue : c.balanceTaxPayable)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          {res.ok && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={save}
            >
              Save as a pack for review
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default function Itr4Page() {
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [fy, setFy] = useState(() =>
    fyText(Math.min(2026, Math.max(2025, fyOf(localToday()) - 1))),
  );
  const [tab, setTab] = useState('taxpayer');
  const [cal, setCal] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    listBusinesses().then((list) => {
      setBusinesses(list);
      setBusinessId((list.find((b) => b.isDefault) || list[0])?.id ?? '');
    }, setError);
  }, []);
  useEffect(() => {
    if (businessId) incomeTaxCalendar(businessId, fy).then(setCal, () => setCal(null));
  }, [businessId, fy]);
  if (error) return <ErrorState error={error} />;
  if (!businesses) return <LoadingState />;
  const y = Number(fy.slice(0, 4));
  return (
    <div className="dashboard-container">
      <PageHeader
        icon={<Calculator size={22} />}
        title="ITR-4 (Sugam)"
        subtitle={
          cal
            ? `${cal.label} · due ${dmy(cal.itr.dueDate)} · ${cal.itr.status.replace('_', ' ')}`
            : 'Income-tax return for proprietors on presumptive income'
        }
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              value={fy}
              onChange={setFy}
              aria-label="Financial year"
              options={[y - 1, y, y + 1]
                .filter((v) => v >= 2025 && v <= 2026)
                .map((v) => ({ value: fyText(v), label: `FY ${fyText(v)}` }))}
            />
          </div>
        }
      />
      <TabStrip tabs={TABS} value={tab} onChange={setTab} ariaLabel="ITR-4 steps" />
      <div style={{ marginTop: 12 }}>
        {!businessId ? (
          <p>Create a business first.</p>
        ) : (
          <>
            {tab === 'taxpayer' && <Taxpayer businessId={businessId} />}
            {tab === 'return' && <ReturnInputs businessId={businessId} fy={fy} />}
            {tab === 'tax' && <TaxPayments businessId={businessId} fy={fy} />}
            {tab === 'ais' && <Ais businessId={businessId} fy={fy} />}
            {tab === 'build' && <Build businessId={businessId} fy={fy} />}
          </>
        )}
      </div>
    </div>
  );
}
