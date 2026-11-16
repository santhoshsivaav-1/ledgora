import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileSpreadsheet } from 'lucide-react';
import { ITR3_BUSINESS_CODES } from '@ledgora/tax-engine/itr3-codes';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { TabStrip } from '../../components/ui/Tabs';
import { Checkbox, Field, MoneyInput, Select, TextInput } from '../../components/ui/Field';
import { toast } from '../../components/ui/Toast';
import { listBusinesses } from '../../lib/data/accounting';
import {
  buildItr3,
  fyOf,
  getItrDraft,
  incomeTaxCalendar,
  saveItrDraft,
  savePack,
} from '../../lib/data/filing';
import { localToday } from '../../utils';
import { Ais, GRID, Taxpayer, TaxPayments, dmy, err, fyText, rupees } from './Itr4Page';

// R2.5: the ITR-3 return for a proprietor whose business income is worked out from the books. The profit and loss account,
// the trading account and the balance sheet come from the ledger, the depreciation from the asset register; this screen takes
// what neither knows (the nature of business, items the Act treats differently, the audit, salary and deductions, TDS) and
// builds the file. The app never files: the file is saved as a pack, reviewed, and uploaded on the income-tax portal.

const TABS = [
  { id: 'taxpayer', label: 'Taxpayer' },
  { id: 'business', label: 'Business & return' },
  { id: 'books', label: 'Books' },
  { id: 'tax', label: 'Challans & advance tax' },
  { id: 'ais', label: 'AIS / TIS' },
  { id: 'build', label: 'Build the file' },
];
const DECL = [
  ['houseProperty', 'Income from house property'],
  ['capitalGains', 'Capital gains'],
  ['foreignAssetsOrIncome', 'Foreign assets or foreign income'],
  ['companyDirector', 'Director of a company'],
  ['unlistedShares', 'Unlisted equity shares'],
  ['partnerInFirm', 'Partner in a firm'],
  ['carriedForwardLoss', 'Losses brought forward from earlier years'],
  ['agriculturalIncomeOver5000', 'Agricultural income over ₹5,000'],
  ['cashDeposits1Crore', 'Cash deposits of ₹1 crore or more in a current account'],
  ['foreignTravel2Lakh', 'Foreign travel spending over ₹2 lakh'],
  ['electricity1Lakh', 'Electricity bill over ₹1 lakh'],
  ['manufacturingAccount', 'You keep a manufacturing account'],
  ['speculativeOrSpecifiedBusiness', 'Speculative or specified business income'],
  ['nonResident', 'You are a non-resident'],
];
const ADJ = [
  ['personalExpenses', 'Personal expenses in the accounts (s.37)'],
  ['otherNotAllowedUs37', 'Other expenses not allowed (s.37): fines, penalties, capital items'],
  ['otherNotAllowedUs36', 'Items not allowed under s.36'],
  ['notAllowedUs40', 'Not allowed under s.40: tax not deducted at source, tax or cess charged'],
  ['cashPaymentsUs40A3', 'Cash payments above ₹10,000 to one person in a day (s.40A(3))'],
  ['deemedIncomeUs41', 'Liability written back or ceased (s.41)'],
];
const DUES = [
  ['taxDutyCess', 'Tax, duty, cess'],
  ['pfEsiContribution', 'PF / ESI contribution'],
  ['bonusCommission', 'Bonus or commission'],
  ['interestToFinancialInstitution', 'Interest to a financial institution'],
  ['loanFromFinancialCompany', 'Loan from a financial company'],
  ['interestToScheduledBank', 'Interest to a scheduled bank'],
  ['leaveEncashment', 'Leave encashment'],
  ['msePayable', 'Payments to micro and small enterprises'],
];
const BLANK_ITR3 = {
  business: { name: '', code: '', description: '', method: 'MERC' },
  servicesTurnover: 0,
  adjustments: {},
  audit: { audited: false },
  loansAreSecured: false,
  employer: null,
  declarations: {},
};
const STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
];

function Inputs({ businessId, fy }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    getItrDraft(businessId, fy).then(
      (r) => setD({ ...r.data, itr3: { ...BLANK_ITR3, ...(r.data.itr3 ?? {}) } }),
      (e) => toast(err(e), 'error'),
    );
  }, [businessId, fy]);
  if (!d) return <LoadingState />;
  const i3 = d.itr3;
  const set3 = (patch) => setD((x) => ({ ...x, itr3: { ...x.itr3, ...patch } }));
  const setBiz = (patch) => set3({ business: { ...i3.business, ...patch } });
  const setAdj = (k) => (v) => set3({ adjustments: { ...i3.adjustments, [k]: v ?? 0 } });
  const setDues = (group, k) => (v) => set3({ adjustments: { ...i3.adjustments, [group]: { ...(i3.adjustments[group] ?? {}), [k]: v ?? 0 } } });
  const setAudit = (patch) => set3({ audit: { ...i3.audit, ...patch } });
  const setDecl = (k) => (v) => set3({ declarations: { ...i3.declarations, [k]: v } });
  const setOs = (patch) => setD((x) => ({ ...x, otherSources: { ...x.otherSources, ...patch } }));
  const setSal = (patch) => setD((x) => ({ ...x, salary: { gross: 0, tds: [], ...(x.salary ?? {}), ...patch } }));
  const setEmp = (patch) =>
    set3({ employer: { name: '', address: '', city: '', stateCode: '33', ...(i3.employer ?? {}), ...patch } });
  const ded = d.deductions ?? {};
  const setDed = (patch) => setD((x) => ({ ...x, deductions: { ...(x.deductions ?? {}), ...patch } }));
  const tds = d.tds ?? [];
  const setTds = (rows) => setD((x) => ({ ...x, tds: rows }));
  const save = async () => {
    try {
      // The return being prepared is the ITR-3; the ITR-4 inputs stay as they were.
      await saveItrDraft(businessId, fy, { ...d, form: 'itr3' });
      toast('Saved', 'success');
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const salary = d.salary;
  return (
    <section className="glass-panel p-4" aria-label="Business and return">
      <p className="ui-help">
        The profit and loss account, the trading account and the balance sheet come from your books, and the depreciation from the
        asset register. Here you give what they do not know.
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
        <Field label="Business name" required>
          <TextInput value={i3.business.name} onChange={(v) => setBiz({ name: v })} />
        </Field>
        <Field label="Nature of business" required>
          <Select
            value={i3.business.code}
            onChange={(v) => setBiz({ code: v })}
            placeholder="Choose the nearest"
            options={ITR3_BUSINESS_CODES.map((c) => ({ value: c.code, label: `${c.code} · ${c.text}` }))}
          />
        </Field>
        <Field label="Short description">
          <TextInput value={i3.business.description ?? ''} onChange={(v) => setBiz({ description: v })} maxLength={125} />
        </Field>
        <Field label="Business started on">
          <TextInput type="date" value={i3.business.commencedOn ?? ''} onChange={(v) => setBiz({ commencedOn: v || undefined })} />
        </Field>
        <Field label="Method of accounting">
          <Select
            value={i3.business.method}
            onChange={(v) => setBiz({ method: v })}
            options={[
              { value: 'MERC', label: 'Mercantile (accrual)' },
              { value: 'CASH', label: 'Cash' },
            ]}
          />
        </Field>
        <Field label="Part of sales that is services" help="Your books hold one sales account; say how much of it is services, the rest is goods">
          <MoneyInput value={i3.servicesTurnover} onChange={(v) => set3({ servicesTurnover: v ?? 0 })} />
        </Field>
      </div>
      <Checkbox
        checked={!!i3.loansAreSecured}
        onChange={(v) => set3({ loansAreSecured: v })}
        label="Loans in the books are secured (against property, stock or assets)"
      />

      <h3 style={{ margin: '16px 0 4px' }}>Items the Income-tax Act treats differently</h3>
      <p className="ui-help">
        Amounts in your accounts that are not allowed as expenses, or allowed in a different year. Leave at zero when none apply. Ask your CA
        if unsure.
      </p>
      <div style={GRID}>
        {ADJ.map(([k, label]) => (
          <Field key={k} label={label}>
            <MoneyInput value={i3.adjustments[k] ?? 0} onChange={setAdj(k)} />
          </Field>
        ))}
      </div>
      <details>
        <summary>Section 43B: dues unpaid on the filing date</summary>
        <div style={GRID}>
          {DUES.map(([k, label]) => (
            <Field key={k} label={label}>
              <MoneyInput value={i3.adjustments.unpaid43B?.[k] ?? 0} onChange={setDues('unpaid43B', k)} />
            </Field>
          ))}
        </div>
      </details>
      <details>
        <summary>Section 43B: dues of earlier years paid this year</summary>
        <div style={GRID}>
          {DUES.map(([k, label]) => (
            <Field key={k} label={label}>
              <MoneyInput value={i3.adjustments.paid43BOfEarlierYears?.[k] ?? 0} onChange={setDues('paid43BOfEarlierYears', k)} />
            </Field>
          ))}
        </div>
      </details>

      <h3 style={{ margin: '16px 0 4px' }}>Tax audit (section 44AB)</h3>
      <p className="ui-help">
        An audit is needed above ₹1 crore of turnover, or ₹10 crore when cash receipts and payments are each 5% or less of the total.
      </p>
      <div style={GRID}>
        <Field label="Cash receipts, % of the total">
          <TextInput value={i3.audit.cashReceiptsPct ?? ''} onChange={(v) => setAudit({ cashReceiptsPct: v === '' ? undefined : Number(v) })} inputMode="decimal" />
        </Field>
        <Field label="Cash payments, % of the total">
          <TextInput value={i3.audit.cashPaymentsPct ?? ''} onChange={(v) => setAudit({ cashPaymentsPct: v === '' ? undefined : Number(v) })} inputMode="decimal" />
        </Field>
      </div>
      <Checkbox checked={!!i3.audit.audited} onChange={(v) => setAudit({ audited: v })} label="The accounts have been audited by a chartered accountant" />
      {i3.audit.audited && (
        <div style={GRID}>
          <Field label="Audit report date">
            <TextInput type="date" value={i3.audit.reportDate ?? ''} onChange={(v) => setAudit({ reportDate: v || undefined })} />
          </Field>
          <Field label="Acknowledgement number of the report (15 digits)">
            <TextInput value={i3.audit.ack ?? ''} onChange={(v) => setAudit({ ack: v })} maxLength={15} />
          </Field>
          <Field label="Auditor’s firm">
            <TextInput value={i3.audit.auditorName ?? ''} onChange={(v) => setAudit({ auditorName: v })} />
          </Field>
          <Field label="Auditor’s PAN">
            <TextInput value={i3.audit.auditorPan ?? ''} onChange={(v) => setAudit({ auditorPan: v.toUpperCase() })} maxLength={10} />
          </Field>
        </div>
      )}

      <h3 style={{ margin: '16px 0 4px' }}>Other income not in the books</h3>
      <p className="ui-help">
        Interest, dividend and rent already in your books are included automatically. Enter here only income that was never booked
        (interest in the AIS, for example).
      </p>
      <div style={GRID}>
        <Field label="Savings-account interest">
          <MoneyInput value={d.otherSources.savingsInterest} onChange={(v) => setOs({ savingsInterest: v ?? 0 })} />
        </Field>
        <Field label="Deposit interest">
          <MoneyInput value={d.otherSources.depositInterest} onChange={(v) => setOs({ depositInterest: v ?? 0 })} />
        </Field>
        <Field label="Interest on income-tax refund">
          <MoneyInput value={d.otherSources.refundInterest} onChange={(v) => setOs({ refundInterest: v ?? 0 })} />
        </Field>
      </div>

      <h3 style={{ margin: '16px 0 4px' }}>Salary</h3>
      <div style={GRID}>
        <Field label="Gross salary">
          <MoneyInput value={salary?.gross ?? 0} onChange={(v) => setSal({ gross: v ?? 0 })} />
        </Field>
        <Field label="Professional tax paid (older regime)">
          <MoneyInput value={salary?.professionalTax ?? 0} onChange={(v) => setSal({ professionalTax: v ?? 0 })} />
        </Field>
      </div>
      {(salary?.gross ?? 0) > 0 && (
        <div style={GRID}>
          <Field label="Employer’s name">
            <TextInput value={i3.employer?.name ?? ''} onChange={(v) => setEmp({ name: v })} />
          </Field>
          <Field label="Employer’s address">
            <TextInput value={i3.employer?.address ?? ''} onChange={(v) => setEmp({ address: v })} />
          </Field>
          <Field label="Employer’s city">
            <TextInput value={i3.employer?.city ?? ''} onChange={(v) => setEmp({ city: v })} />
          </Field>
          <Field label="Employer’s state">
            <Select value={i3.employer?.stateCode ?? '33'} onChange={(v) => setEmp({ stateCode: v })} options={STATES.map(([v, l]) => ({ value: v, label: l }))} />
          </Field>
        </div>
      )}

      <h3 style={{ margin: '16px 0 4px' }}>Deductions (older regime)</h3>
      <div style={GRID}>
        <Field label="80C: amount">
          <MoneyInput
            value={ded.sec80C?.reduce((s, r) => s + r.amount, 0) ?? 0}
            onChange={(v) => setDed({ sec80C: v ? [{ id: ded.sec80C?.[0]?.id || 'POLICY', amount: v }] : [] })}
          />
        </Field>
        <Field label="80C: policy or document number">
          <TextInput value={ded.sec80C?.[0]?.id ?? ''} onChange={(v) => setDed({ sec80C: [{ id: v, amount: ded.sec80C?.[0]?.amount ?? 0 }] })} />
        </Field>
        <Field label="80CCD(1B): NPS">
          <MoneyInput value={ded.sec80CCD1B ?? 0} onChange={(v) => setDed({ sec80CCD1B: v ?? 0 })} />
        </Field>
        <Field label="80CCD(2): employer’s NPS">
          <MoneyInput value={ded.sec80CCD2 ?? 0} onChange={(v) => setDed({ sec80CCD2: v ?? 0 })} />
        </Field>
        <Field label="80D: health-insurance premium (self and family)">
          <MoneyInput
            value={ded.sec80D?.selfPremiums?.[0]?.amount ?? 0}
            onChange={(v) => setDed({ sec80D: { ...(ded.sec80D ?? {}), selfPremiums: v ? [{ insurer: ded.sec80D?.selfPremiums?.[0]?.insurer || 'Insurer', policy: ded.sec80D?.selfPremiums?.[0]?.policy || 'POLICY', amount: v }] : [] } })}
          />
        </Field>
      </div>

      <h3 style={{ margin: '16px 0 4px' }}>TDS deducted from your receipts</h3>
      {tds.map((r, i) => (
        <div key={i} style={GRID}>
          <Field label="TAN of the deductor">
            <TextInput value={r.tan} onChange={(v) => setTds(tds.map((x, j) => (j === i ? { ...x, tan: v.toUpperCase() } : x)))} maxLength={10} />
          </Field>
          <Field label="Deductor’s name">
            <TextInput value={r.name} onChange={(v) => setTds(tds.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
          </Field>
          <Field label="Section (e.g. 94C)">
            <TextInput value={r.section} onChange={(v) => setTds(tds.map((x, j) => (j === i ? { ...x, section: v } : x)))} />
          </Field>
          <Field label="Amount paid to you">
            <MoneyInput value={r.gross} onChange={(v) => setTds(tds.map((x, j) => (j === i ? { ...x, gross: v ?? 0 } : x)))} />
          </Field>
          <Field label="TDS deducted">
            <MoneyInput value={r.tdsDeducted} onChange={(v) => setTds(tds.map((x, j) => (j === i ? { ...x, tdsDeducted: v ?? 0, tdsClaimed: v ?? 0 } : x)))} />
          </Field>
          <Field label=" ">
            <button type="button" className="btn btn-secondary" onClick={() => setTds(tds.filter((_, j) => j !== i))}>
              Remove
            </button>
          </Field>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={() => setTds([...tds, { tan: '', name: '', section: '94C', gross: 0, tdsDeducted: 0, tdsClaimed: 0, headOfIncome: 'BP' }])}>
        Add a deductor
      </button>

      <h3 style={{ margin: '16px 0 4px' }}>Not possible in this builder yet</h3>
      <p className="ui-help">
        Tick whatever applies to you. If any apply, the return needs schedules this builder does not file yet, and it is not built: file
        it on the portal.
      </p>
      {DECL.map(([k, label]) => (
        <Checkbox key={k} checked={!!i3.declarations[k]} onChange={setDecl(k)} label={label} />
      ))}
      <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>
        Save
      </button>
    </section>
  );
}

const PL_ROWS = [
  ['saleOfGoods', 'Sales of goods'],
  ['saleOfServices', 'Sales of services'],
  ['openingStock', 'Opening stock'],
  ['purchases', 'Purchases'],
  ['carriageInward', 'Carriage inward'],
  ['powerAndFuel', 'Power and fuel'],
  ['closingStock', 'Closing stock'],
  ['interestIncome', 'Interest received'],
  ['dividendIncome', 'Dividend received'],
  ['rentIncome', 'Rent received'],
  ['commissionIncome', 'Commission received'],
  ['salariesAndWages', 'Salaries and wages'],
  ['rentPaid', 'Rent paid'],
  ['interestPaid', 'Interest paid'],
  ['bookDepreciation', 'Depreciation in the books'],
];
const BS_ROWS = [
  ['proprietorCapital', 'Proprietor’s capital (with profit)'],
  ['securedLoansFromBanks', 'Secured loans from banks'],
  ['securedLoansFromOthers', 'Secured loans from others'],
  ['unsecuredLoansFromBanks', 'Unsecured loans from banks'],
  ['unsecuredLoansFromOthers', 'Unsecured loans from others'],
  ['advancesFromOthers', 'Advances received'],
  ['sundryCreditors', 'Sundry creditors'],
  ['otherCurrentLiabilities', 'Other current liabilities'],
  ['provisions', 'Provisions'],
  ['grossBlock', 'Fixed assets, cost'],
  ['accumulatedDepreciation', 'Less: depreciation'],
  ['inventories', 'Stock'],
  ['sundryDebtors', 'Sundry debtors'],
  ['cashInHand', 'Cash in hand'],
  ['bankBalances', 'Bank balances'],
  ['otherCurrentAssets', 'Other current assets'],
  ['loansAndAdvancesRecoverable', 'Loans and advances'],
  ['balanceWithRevenueAuthorities', 'Balance with revenue authorities (GST input, TDS)'],
];

function Issues({ issues }) {
  return issues.map((i) => (
    <p key={i.id} role={i.severity === 'error' ? 'alert' : 'status'}>
      <StatusChip tone={i.severity === 'error' ? 'danger' : 'warning'}>{i.severity}</StatusChip> {i.message}
    </p>
  ));
}

function Books({ businessId, fy }) {
  const [res, setRes] = useState(null);
  const load = useCallback(() => {
    setRes(null);
    buildItr3(businessId, fy, localToday()).then(setRes, (e) => {
      toast(err(e), 'error');
      setRes(false);
    });
  }, [businessId, fy]);
  useEffect(load, [load]);
  if (res === null) return <LoadingState />;
  if (res === false) return <p>The books could not be read.</p>;
  const st = res.statements;
  if (!st)
    return (
      <section className="glass-panel p-4" aria-label="Books">
        <p className="ui-help">The books are shown once the taxpayer details and the business details are saved.</p>
        <Issues issues={res.issues} />
      </section>
    );
  const k = st.calc;
  const balanced = k.fundsSource === k.fundsApplied;
  return (
    <section className="glass-panel p-4" aria-label="Books">
      <p className="ui-help">
        What the return will say, read from your ledger and asset register. If a figure is wrong, correct it in the books, not here.
      </p>
      <Issues issues={res.issues.filter((i) => i.code !== 'SW_CODE_UNREGISTERED')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Trading and profit and loss account</h3>
          <table className="ui-table" style={{ width: '100%' }}>
            <tbody>
              {PL_ROWS.map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(st.books[key])}</td>
                </tr>
              ))}
              {st.books.otherExpenses.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(x.amount)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Gross profit</b>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <b>{rupees(k.grossProfit)}</b>
                </td>
              </tr>
              <tr>
                <td>
                  <b>Profit before tax</b>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <b>{rupees(k.profitBeforeTax)}</b>
                </td>
              </tr>
              <tr>
                <td>Tax depreciation replaces the books’ depreciation</td>
                <td style={{ textAlign: 'right' }}>{rupees(k.taxDepreciation)}</td>
              </tr>
              <tr>
                <td>
                  <b>Business income</b>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <b>{rupees(k.businessIncome)}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>
            Balance sheet <StatusChip tone={balanced ? 'success' : 'danger'}>{balanced ? 'balanced' : 'does not balance'}</StatusChip>
          </h3>
          <table className="ui-table" style={{ width: '100%' }}>
            <tbody>
              {BS_ROWS.map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(st.balanceSheet[key])}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Sources of funds</b>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <b>{rupees(k.fundsSource)}</b>
                </td>
              </tr>
              <tr>
                <td>
                  <b>Application of funds</b>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <b>{rupees(k.fundsApplied)}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} onClick={load}>
        Read the books again
      </button>
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
      setRes(await buildItr3(businessId, fy, filedOn));
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    try {
      const pack = await savePack({ businessId, kind: 'itr3', period: res.period, payload: res.payload });
      navigate(`/filing/${pack.id}`);
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const c = res?.computation;
  return (
    <section className="glass-panel p-4" aria-label="Build the file">
      <p className="ui-help">
        The date you plan to file on decides the late fee and the filing section, so use the real date. The file is checked against the
        department’s own rules (by number) and its format before you can save it.
      </p>
      <div style={GRID}>
        <Field label="Planned filing date">
          <TextInput type="date" value={filedOn} onChange={setFiledOn} />
        </Field>
      </div>
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
        {busy ? 'Building…' : 'Build the ITR-3 file'}
      </button>
      {res && (
        <div style={{ marginTop: 16 }}>
          <Issues issues={res.issues} />
          {c && (
            <table className="ui-table" style={{ width: '100%', maxWidth: 480 }}>
              <tbody>
                <tr>
                  <td>Profit before tax (books)</td>
                  <td>{rupees(c.calc.profitBeforeTax)}</td>
                </tr>
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
                  <td>Paid (TDS, TCS, advance, self-assessment)</td>
                  <td>{rupees(c.tdsTotal + c.tcsTotal + c.advanceTaxPaid + c.selfAssessmentTaxPaid)}</td>
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
            <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>
              Save as a pack for review
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default function Itr3Page() {
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [fy, setFy] = useState(() => fyText(Math.min(2026, Math.max(2025, fyOf(localToday()) - 1))));
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
        icon={<FileSpreadsheet size={22} />}
        title="ITR-3 (business income)"
        subtitle={
          cal
            ? `${cal.label} · due ${dmy(cal.itr.dueDate)} (31 October with a tax audit) · ${cal.itr.status.replace('_', ' ')}`
            : 'Income-tax return for a proprietor whose business income comes from the books'
        }
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/fixed-assets')}>
              Fixed assets
            </button>
            <Select
              value={fy}
              onChange={setFy}
              aria-label="Financial year"
              options={[y - 1, y, y + 1].filter((v) => v >= 2025 && v <= 2026).map((v) => ({ value: fyText(v), label: `FY ${fyText(v)}` }))}
            />
          </div>
        }
      />
      <TabStrip tabs={TABS} value={tab} onChange={setTab} ariaLabel="ITR-3 steps" />
      <div style={{ marginTop: 12 }}>
        {!businessId ? (
          <p>Create a business first.</p>
        ) : (
          <>
            {tab === 'taxpayer' && <Taxpayer businessId={businessId} />}
            {tab === 'business' && <Inputs businessId={businessId} fy={fy} />}
            {tab === 'books' && <Books businessId={businessId} fy={fy} />}
            {tab === 'tax' && <TaxPayments businessId={businessId} fy={fy} />}
            {tab === 'ais' && <Ais businessId={businessId} fy={fy} />}
            {tab === 'build' && <Build businessId={businessId} fy={fy} />}
          </>
        )}
      </div>
    </div>
  );
}
