import { useState } from 'react';
import { FileSpreadsheet, Barcode, Library, Pencil, Printer, Trash2, Users } from 'lucide-react';
import { useTheme } from '../../app/providers';
import { setBrand, setUiMode, useBrand, useUiMode } from '../../app/uiMode';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import { FilterBar, PeriodPicker, SearchInput, SummaryChips } from '../../components/ui/FilterBar';
import { Checkbox, Field, MoneyInput, QtyInput, RadioCards, Select, Switch, TextInput } from '../../components/ui/Field';
import DateInput from '../../components/ui/DateInput';
import Combobox from '../../components/ui/Combobox';
import { FileDrop, GstinInput, PhoneInput, StateSelect } from '../../components/ui/IndiaInputs';
import Modal, { Drawer } from '../../components/ui/Modal';
import Menu from '../../components/ui/Menu';
import { Stepper, TabStrip } from '../../components/ui/Tabs';
import { Avatar, Badge, Kbd, Money, OptionCard, PaymentStatusChip, PromoCard, Skeleton, StatusChip } from '../../components/ui/Display';
import { EmptyState } from '../../components/ui/States';
import ActionBar, { SaveButton, useSaveShortcut } from '../../components/ui/ActionBar';
import LinesGrid, { blankLine } from '../../components/ui/LinesGrid';
import LivePreview from '../../components/ui/LivePreview';
import ReportShell from '../../components/ui/ReportShell';
import { SettingRow, SettingsSection } from '../../components/ui/SettingRow';
import { toast } from '../../components/ui/Toast';
import { formatMoney } from '../../components/ui/lib/format';

// /dev/ui (development builds only): every shared component in its states, to check them in light and dark and
// in both brands before a screen uses them. Not linked from any menu.

const PARTIES = [
  { id: 'p1', label: 'Ravi Traders', phone: '98450 11111' },
  { id: 'p2', label: 'Sharma & Sons', phone: '98450 22222' },
  { id: 'p3', label: 'Meena Textiles', phone: '98450 33333' },
  { id: 'p4', label: 'Kumar Hardware', phone: '98450 44444' },
];
const searchParties = (q) =>
  new Promise((resolve) => setTimeout(() => resolve(PARTIES.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()))), 150));

const ROWS = [
  { id: 'r1', date: '2026-11-06', no: 'INV-12', party: 'Ravi Traders', amount: 8260, balance: 8260, status: 'unpaid' },
  { id: 'r2', date: '2026-11-04', no: 'INV-11', party: 'Sharma & Sons', amount: 15340.5, balance: 0, status: 'paid' },
  { id: 'r3', date: '2026-11-02', no: 'INV-10', party: 'Meena Textiles', amount: 4720, balance: 2000, status: 'partial' },
  { id: 'r4', date: '2026-10-28', no: 'INV-9', party: 'Kumar Hardware', amount: -1180, balance: -1180, status: 'overdue' },
];
const COLUMNS = [
  { id: 'date', header: 'Date', sortable: true },
  { id: 'no', header: 'Invoice No', sortable: true },
  { id: 'party', header: 'Party', sortable: true },
  { id: 'amount', header: 'Amount', format: 'money', sortable: true, total: 'sum' },
  { id: 'balance', header: 'Balance', sortable: true, total: 'sum', align: 'right', render: (r) => <Money value={r.balance} signed currency={false} /> },
  { id: 'status', header: 'Status', render: (r) => <PaymentStatusChip status={r.status} /> },
];

const DEMO_REPORT = {
  id: 'demo-sales',
  title: 'Sale Report (demo)',
  group: 'Transaction',
  description: 'Sample data so the shell can be seen; Phase 6 points each report at GET /v1/reports/:id.',
  filters: [{ kind: 'period' }, { kind: 'select', id: 'type', label: 'Type', options: [{ value: 'all', label: 'All types' }, { value: 'invoice', label: 'Invoices' }] }, { kind: 'search' }],
  columns: COLUMNS.slice(0, 5),
  summary: (rows) => [
    { label: 'Total', value: rows.reduce((s, r) => s + r.amount, 0) },
    { label: 'Unpaid', value: rows.reduce((s, r) => s + Math.max(0, r.balance), 0), tone: 'neg' },
  ],
  fetch: () => new Promise((resolve) => setTimeout(() => resolve({ rows: ROWS }), 400)),
  exports: ['pdf', 'xlsx', 'share'],
};

function Section({ title, children }) {
  return (
    <section className="ui-card ui-card-pad">
      <h2 className="ui-section-title">{title}</h2>
      {children}
    </section>
  );
}

export default function UiGallery() {
  const { dark, toggle } = useTheme();
  const mode = useUiMode();
  const brand = useBrand();
  const [text, setText] = useState('');
  const [money, setMoney] = useState(123456.5);
  const [qty, setQty] = useState(2.5);
  const [date, setDate] = useState('2026-11-06');
  const [party, setParty] = useState(null);
  const [gstin, setGstin] = useState('29');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState('Karnataka');
  const [sel, setSel] = useState('b2b');
  const [on, setOn] = useState(true);
  const [check, setCheck] = useState(false);
  const [method, setMethod] = useState('excel');
  const [tab, setTab] = useState('transactions');
  const [period, setPeriod] = useState(null);
  const [modal, setModal] = useState(false);
  const [dirtyModal, setDirtyModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tableState, setTableState] = useState('data');
  const [lines, setLines] = useState([{ ...blankLine(), item: 'Steel rod 12mm', hsn: '7214', qty: 10, rate: 450 }, blankLine()]);
  const [saving, setSaving] = useState(false);
  useSaveShortcut(() => toast('Ctrl+S: saved (demo)', 'success'), () => toast('Ctrl+Shift+S: saved, new form (demo)', 'success'));

  const lineAmount = (l) => {
    const base = (Number(l.qty) || 0) * (Number(l.rate) || 0) * (1 - (Number(l.discount) || 0) / 100);
    return base * (1 + (Number(l.gst) || 0) / 100);
  };

  return (
    <div className="ui-gallery">
      <PageHeader
        compact
        title="Component gallery"
        breadcrumb={[{ label: 'Dev' }, { label: 'UI' }]}
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={toggle}>
              {dark ? 'Light' : 'Dark'} theme
            </button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setBrand(brand === 'vyapar' ? 'ledgora' : 'vyapar')}>
              Brand: {brand}
            </button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setUiMode(mode === 'vyapar' ? 'classic' : 'vyapar')}>
              Shell: {mode}
            </button>
          </>
        }
      />

      <Section title="Buttons, chips, badges">
        <div className="ui-gallery-row">
          <button type="button" className="ui-btn ui-btn-primary">Primary</button>
          <button type="button" className="ui-btn ui-btn-secondary">Secondary</button>
          <button type="button" className="ui-btn ui-btn-ghost">Ghost link</button>
          <button type="button" className="ui-btn ui-btn-danger">Delete</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled>Disabled</button>
          <SaveButton busy={saving} onClick={() => { setSaving(true); setTimeout(() => setSaving(false), 1200); }}>Save</SaveButton>
        </div>
        <div className="ui-gallery-row" style={{ marginTop: 'var(--s-3)' }}>
          {['paid', 'partial', 'unpaid', 'cancelled', 'overdue'].map((s) => <PaymentStatusChip key={s} status={s} />)}
          <StatusChip tone="info">Info</StatusChip>
          <Badge>3</Badge>
          <Badge tone="pos">New</Badge>
          <Badge tone="neutral">12</Badge>
          <Kbd>Ctrl</Kbd>
          <Kbd>F</Kbd>
          <Avatar name="Santhosh Kumar" />
          <Money value={248000.5} />
          <Money value={-1180} signed />
          <Money value={5000} signed />
        </div>
      </Section>

      <Section title="Filter bar and summary chips">
        <FilterBar right={<button type="button" className="ui-btn ui-btn-secondary">Export</button>}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <Select aria-label="Status" value={sel} onChange={setSel} options={[{ value: 'b2b', label: 'All parties' }, { value: 'b2c', label: 'Customers' }]} />
          <SearchInput value={text} onChange={setText} />
        </FilterBar>
        {period && <p className="ui-help">Chosen: {period.label}, {period.from} to {period.to}</p>}
        <SummaryChips chips={[{ label: 'Total', value: 480000 }, { label: 'Paid', value: 310000, tone: 'pos' }, { label: 'Unpaid', value: 170000, tone: 'neg' }, { label: 'Due this week', value: 42000, tone: 'warn' }]} />
      </Section>

      <Section title="DataTable">
        <div className="ui-gallery-row" style={{ marginBottom: 'var(--s-3)' }}>
          {['data', 'loading', 'empty', 'error'].map((k) => (
            <button key={k} type="button" className={`ui-btn ui-btn-sm ${tableState === k ? 'ui-btn-primary' : 'ui-btn-secondary'}`} onClick={() => setTableState(k)}>
              {k}
            </button>
          ))}
        </div>
        <DataTable
          id="gallery.invoices"
          columns={COLUMNS}
          rows={tableState === 'data' ? ROWS : []}
          loading={tableState === 'loading'}
          error={tableState === 'error' ? 'The server did not answer.' : null}
          onRetry={() => setTableState('data')}
          empty={<EmptyState title="No invoices yet" hint="Your first sale shows up here." illustration={<FileSpreadsheet size={32} />} action={<button type="button" className="ui-btn ui-btn-primary">+ Add Sale</button>} secondary={<button type="button" className="ui-btn ui-btn-secondary">Import from Excel</button>} />}
          selectable
          columnPicker
          exportable={{ filename: 'gallery-invoices', title: 'Invoices' }}
          rowActions={(r) => [
            { label: 'Edit', icon: Pencil, onSelect: () => toast(`Edit ${r.no}`) },
            { label: 'Print', icon: Printer, onSelect: () => toast(`Print ${r.no}`) },
            'sep',
            { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => toast(`${r.no} moved to Trash`, 'info', 6000, { action: { label: 'Undo', onClick: () => toast('Restored', 'success') } }) },
          ]}
          onRowClick={(r) => toast(`Open ${r.no}`)}
          pagination={{ summary: '1–4 of 4', cursor: null, onNext: () => {}, onPrev: null, pageSize: 50, onPageSize: () => {} }}
        />
      </Section>

      <Section title="Form primitives">
        <div className="ui-gallery-grid">
          <Field label="Customer Name" required help="As printed on the invoice">
            <TextInput value={text} onChange={setText} maxLength={80} />
          </Field>
          <Field label="Amount" help={`Value: ${money ?? 'empty'}`}>
            <MoneyInput value={money} onChange={setMoney} />
          </Field>
          <Field label="Quantity">
            <QtyInput value={qty} onChange={setQty} />
          </Field>
          <Field label="Invoice date" help="Type 060126 or pick">
            <DateInput value={date} onChange={setDate} min="2026-04-01" max="2027-03-31" />
          </Field>
          <Field label="Party" required>
            <Combobox value={party} onChange={setParty} search={searchParties} onCreate={(name) => toast(`Would open Add Party for “${name}”`)} renderOption={(p) => (<span>{p.label} <span className="ui-help">· {p.phone}</span></span>)} />
          </Field>
          <Field label="GSTIN">
            <GstinInput value={gstin} onChange={setGstin} />
          </Field>
          <Field label="Mobile">
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="State">
            <StateSelect value={state} onChange={setState} />
          </Field>
          <Field label="With an error" error="This field is required">
            <TextInput value="" onChange={() => {}} />
          </Field>
          <div className="ui-field">
            <Switch checked={on} onChange={setOn} label="Print signature" />
            <Checkbox checked={check} onChange={setCheck} label="Send on WhatsApp" />
          </div>
        </div>
        <div style={{ marginTop: 'var(--s-4)' }}>
          <RadioCards value={sel} onChange={setSel} ariaLabel="Party type" options={[{ value: 'b2b', label: 'Registered business', description: 'Has a GSTIN' }, { value: 'b2c', label: 'Consumer', description: 'No GSTIN' }]} />
        </div>
        <div style={{ marginTop: 'var(--s-4)' }}>
          <FileDrop onFiles={(f) => toast(`${f[0].name} attached`, 'success')} onReject={() => toast('That file is over 5 MB', 'error')} />
        </div>
      </Section>

      <Section title="Option cards (Import method)">
        <div className="ui-gallery-grid">
          <OptionCard name="method" value="barcode" checked={method === 'barcode'} onChange={setMethod} badge="RECOMMENDED" icon={<Barcode size={36} />} title="Import From Barcode" text="Scan items to add them with their details." />
          <OptionCard name="method" value="excel" checked={method === 'excel'} onChange={setMethod} icon={<FileSpreadsheet size={36} />} title="Import From Excel" text="Upload a sheet of items." />
          <OptionCard name="method" value="library" checked={method === 'library'} onChange={setMethod} icon={<Library size={36} />} title="Import From Library" text="Pick from a ready list." />
        </div>
      </Section>

      <Section title="Tabs, stepper, menu, promo, skeleton">
        <TabStrip tabs={[{ id: 'transactions', label: 'Transactions', count: 12 }, { id: 'ledger', label: 'Ledger' }, { id: 'details', label: 'Details' }]} value={tab} onChange={setTab} ariaLabel="Party sections" />
        <Stepper steps={['Upload', 'Map columns', 'Review', 'Import']} current={2} />
        <div className="ui-gallery-row">
          <Menu items={[{ label: 'View', onSelect: () => toast('View') }, { label: 'Export (needs data:export)', perm: 'data:export', onSelect: () => toast('Export') }, 'sep', { label: 'Delete', tone: 'danger', onSelect: () => toast('Deleted') }]} />
          <Skeleton width={160} />
          <Skeleton width={80} height={24} />
        </div>
        <div style={{ marginTop: 'var(--s-3)' }}>
          <PromoCard icon={<Users size={24} />} title="Invite your accountant" text="Give your CA read-only access to reports." action={<button type="button" className="ui-btn ui-btn-primary ui-btn-sm">Invite</button>} />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="ui-gallery-row">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setModal(true)}>Open modal</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDirtyModal(true)}>Modal with unsaved changes</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDrawer(true)}>Open drawer</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => toast('Saved', 'success')}>Toast</button>
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title="Add Party" footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setModal(false)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={() => setModal(false)}>Save</button></>}>
          <Field label="Party Name" required>
            <TextInput value={text} onChange={setText} />
          </Field>
        </Modal>
        <Modal open={dirtyModal} onClose={() => setDirtyModal(false)} dirty title="Edit Item" size="sm">
          Press Esc or the ×: it asks before discarding.
        </Modal>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Ravi Traders">
          <SummaryChips chips={[{ label: 'To collect', value: 8260, tone: 'pos' }]} />
          <p className="ui-help">A peek at a party without leaving the list.</p>
        </Drawer>
      </Section>

      <Section title="LinesGrid with LivePreview">
        <LivePreview
          draft={lines}
          renderPreview={(d) => (
            <div style={{ background: 'var(--surface)', padding: 'var(--s-3)', borderRadius: 'var(--r-sm)' }}>
              <b>Tax Invoice</b>
              {d.filter((l) => l.item).map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{l.item}</span>
                  <span>₹{formatMoney(lineAmount(l))}</span>
                </div>
              ))}
            </div>
          )}
        >
          <LinesGrid docType="purchase" lines={lines} onChange={setLines} amountOf={lineAmount} />
        </LivePreview>
        <ActionBar
          left={<button type="button" className="ui-btn ui-btn-ghost">Back</button>}
          right={<><button type="button" className="ui-btn ui-btn-secondary">Save &amp; New</button><button type="button" className="ui-btn ui-btn-primary">Save</button></>}
        />
      </Section>

      <Section title="Settings rows">
        <SettingsSection title="Invoice">
          <SettingRow label="Round off total" help="Rounds the grand total to the nearest rupee.">
            <Switch checked={on} onChange={setOn} />
          </SettingRow>
          <SettingRow label="Default due days" help="Added to the invoice date.">
            <Select value="15" onChange={() => {}} options={['7', '15', '30']} />
          </SettingRow>
        </SettingsSection>
      </Section>

      <Section title="ReportShell">
        <ReportShell def={DEMO_REPORT} breadcrumb={[{ label: 'Dev' }, { label: 'ReportShell' }]} />
      </Section>
    </div>
  );
}
