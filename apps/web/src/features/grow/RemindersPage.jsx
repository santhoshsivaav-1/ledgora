import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import PageHeader from '../../components/ui/PageHeader';
import { UrlTabs } from '../../components/ui/Tabs';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { Field } from '../../components/ui/Field';
import { StatusChip } from '../../components/ui/Display';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { toast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils';
import { listBusinesses } from '../../lib/data/accounting';
import { useEntitlements } from '../billing/useEntitlements';
import * as api from '../../lib/data/messaging';

// P9-S2 / S5: Grow > Reminders. Payment reminders (overdue list, bulk send with a summary), service reminders, the
// Messages log and the message templates. WhatsApp is click-to-send: the server prepares the message, the person opens it.

const TABS = [
  { id: 'payment', label: 'Payment reminders' },
  { id: 'service', label: 'Service' },
  { id: 'messages', label: 'Messages' },
  { id: 'templates', label: 'Templates' },
];
const err = (e) => e?.message || 'Something went wrong';
const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '–');

function PaymentTab({ businessId, channels }) {
  const { can } = useEntitlements();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [channel, setChannel] = useState('whatsapp');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.listReminders(businessId).then(setData).catch(setError), [businessId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={err(error)} onRetry={load} />;
  if (!data) return <LoadingState label="Loading overdue invoices…" />;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const send = async () => {
    setBusy(true);
    try { setResult(await api.sendReminders(businessId, [...picked], channel)); setPicked(new Set()); load(); } catch (e) { toast(err(e), 'error'); } finally { setBusy(false); }
  };
  const open = async (s) => { window.open(s.url, '_blank', 'noopener'); await api.markOpened(s.messageId).catch(() => {}); load(); };
  const optOut = async (r) => {
    if (await confirmAction({ title: `Stop messaging ${r.partyName}?`, message: 'No reminder, share or service message will be sent to this party until you turn it back on.', confirmLabel: 'Do not message', tone: 'warning' })) {
      await api.setDoNotMessage(r.partyId, true).catch((e) => toast(err(e), 'error')); load();
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}>
        <strong>Overdue {formatCurrency(data.totalOverdue)} across {data.parties} part{data.parties === 1 ? 'y' : 'ies'}</strong>
        <span style={{ flex: 1 }} />
        <select className="ui-select" aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="whatsapp">WhatsApp</option>
          {channels.email && <option value="email">Email</option>}
        </select>
        <button type="button" className="btn btn-primary" disabled={!picked.size || busy || !can('message:write')} onClick={send}>
          {busy ? 'Sending…' : `Send to ${picked.size || ''} selected`}
        </button>
      </div>
      {result && (
        <div role="status" className="ui-card ui-card-pad" style={{ marginBottom: 12 }}>
          <strong>Sent {result.sent.length}, skipped {result.skipped.length}</strong>
          {result.preview && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '8px 0' }}>First message: {result.preview}</pre>}
          {result.sent.filter((s) => s.url).map((s) => {
            const r = data.data.find((d) => d.invoiceId === s.invoiceId);
            return <div key={s.messageId}><button type="button" className="btn btn-secondary" onClick={() => open(s)}>Open WhatsApp for {r?.partyName || s.invoiceId}</button></div>;
          })}
          {result.skipped.map((s) => <div key={s.invoiceId} className="ui-help">{data.data.find((d) => d.invoiceId === s.invoiceId)?.number || s.invoiceId}: {s.reason}</div>)}
        </div>
      )}
      {data.data.length === 0 ? <EmptyState title="Nothing is overdue" hint="Unpaid invoices past their due date show here." /> : (
        <table className="ui-table" style={{ width: '100%' }}>
          <thead><tr><th /><th>Party</th><th>Invoice</th><th>Due</th><th>Days late</th><th>Pending</th><th>Last reminder</th><th /></tr></thead>
          <tbody>
            {data.data.map((r) => (
              <tr key={r.invoiceId}>
                <td><input type="checkbox" aria-label={`Select ${r.number}`} disabled={r.optedOut} checked={picked.has(r.invoiceId)} onChange={() => toggle(r.invoiceId)} /></td>
                <td>{r.partyName} {r.optedOut && <StatusChip tone="neutral">Do not message</StatusChip>}</td>
                <td>{r.number}</td><td>{dmy(r.dueDate)}</td><td>{r.daysLate}</td><td>{formatCurrency(r.pending)}</td>
                <td>{r.lastReminderAt ? `${dmy(r.lastReminderAt.slice(0, 10))} (${r.lastChannel})` : '–'}</td>
                <td>{r.partyId && !r.optedOut && <button type="button" className="btn btn-ghost" onClick={() => optOut(r)}>Do not message</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ServiceTab({ businessId }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ name: '', intervalUnit: 'months', intervalEvery: 12, remindBeforeDays: 7, channel: 'whatsapp' });
  const load = useCallback(() => api.listServiceReminders(businessId).then(setRows).catch((e) => toast(err(e), 'error')), [businessId]);
  useEffect(() => { load(); }, [load]);
  const run = (fn) => async () => { try { await fn(); await load(); } catch (e) { toast(err(e), 'error'); } };
  if (!rows) return <LoadingState />;
  return (
    <div>
      <div className="ui-card ui-card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
        <Field label="Name"><input className="ui-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="AC annual service" /></Field>
        <Field label="Every"><input type="number" min="1" className="ui-input" style={{ width: 80 }} value={form.intervalEvery} onChange={(e) => setForm({ ...form, intervalEvery: Number(e.target.value) })} /></Field>
        <Field label="Unit"><select className="ui-select" value={form.intervalUnit} onChange={(e) => setForm({ ...form, intervalUnit: e.target.value })}><option value="months">months</option><option value="days">days</option></select></Field>
        <Field label="Remind (days before)"><input type="number" min="0" className="ui-input" style={{ width: 80 }} value={form.remindBeforeDays} onChange={(e) => setForm({ ...form, remindBeforeDays: Number(e.target.value) })} /></Field>
        <button type="button" className="btn btn-primary" disabled={!form.name.trim()} onClick={run(async () => { await api.addServiceReminder({ businessId, ...form, name: form.name.trim() }); setForm({ ...form, name: '' }); })}>Add reminder</button>
      </div>
      {rows.length === 0 ? <EmptyState title="No service reminders" hint="Add one for something you service on a schedule." /> : (
        <table className="ui-table" style={{ width: '100%' }}>
          <thead><tr><th>Name</th><th>Party</th><th>Every</th><th>Next due</th><th>In</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td><td>{r.partyName || '–'}</td><td>{r.intervalEvery} {r.intervalUnit}</td><td>{dmy(r.nextDue)}</td>
                <td>{r.daysLeft < 0 ? <StatusChip tone="danger">{-r.daysLeft} days late</StatusChip> : `${r.daysLeft} days`}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-secondary" onClick={run(() => api.markServiceDone(r.id))}>Done</button>
                  <button type="button" className="btn btn-secondary" onClick={run(() => api.snoozeService(r.id, 7))}>Snooze 7 days</button>
                  <button type="button" className="btn btn-ghost" onClick={run(() => api.deleteService(r.id))}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="ui-help">A reminder with a party sends the “service due” message that many days before the due date, once. Done starts the next cycle from today; Snooze moves only the due date.</p>
    </div>
  );
}

function MessagesTab({ businessId }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => api.listMessages(businessId).then(setRows).catch((e) => toast(err(e), 'error')), [businessId]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <LoadingState />;
  if (!rows.length) return <EmptyState title="No messages yet" hint="Shared documents and reminders are logged here." />;
  const tone = { sent: 'success', delivered: 'success', failed: 'danger', queued: 'neutral', cancelled: 'neutral' };
  return (
    <table className="ui-table" style={{ width: '100%' }}>
      <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Event</th><th>Status</th><th /></tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td>{new Date(m.scheduledAt).toLocaleString()}</td><td>{m.channel}</td><td>{m.to}</td><td>{m.event}</td>
            <td><StatusChip tone={tone[m.status] || 'neutral'}>{m.status}</StatusChip>{m.error && <div className="ui-help">{m.error}</div>}</td>
            <td>{m.status === 'failed' && <button type="button" className="btn btn-secondary" onClick={async () => { await api.retryMessage(m.id).catch((e) => toast(err(e), 'error')); load(); }}>Retry</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const VARS = ['party', 'number', 'amount', 'balance', 'due_date', 'business', 'link', 'date', 'items'];
function TemplatesTab({ businessId }) {
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState({ event: 'reminder', channel: 'whatsapp' });
  const [body, setBody] = useState('');
  const load = useCallback(async () => setRows(await api.listTemplates(businessId)), [businessId]);
  useEffect(() => { load().catch((e) => toast(err(e), 'error')); }, [load]);
  const cur = useMemo(() => rows?.find((r) => r.event === sel.event && r.channel === sel.channel), [rows, sel]);
  useEffect(() => { if (cur) setBody(cur.body); }, [cur]);
  if (!rows) return <LoadingState />;
  const unknown = [...body.matchAll(/\{([a-z_]+)\}/gi)].map((m) => m[1]).filter((n) => !VARS.includes(n));
  const sample = body.replace(/\{([a-z_]+)\}/gi, (w, n) => ({ party: 'Ravi Traders', number: 'INV-12', amount: '₹8,260', balance: '₹8,260', due_date: '25-10-2026', business: 'Sri Traders', link: 'https://…/s/…', date: '01-10-2026', items: 'Widget x 2' })[n] ?? w);
  const save = async () => { try { await api.saveTemplate({ businessId, ...sel, language: 'en', subject: cur.subject, body, active: true }); toast('Saved', 'success', 1500); await load(); } catch (e) { toast(err(e), 'error'); } };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select className="ui-select" aria-label="Event" value={sel.event} onChange={(e) => setSel({ ...sel, event: e.target.value })}>{[...new Set(rows.map((r) => r.event))].map((e) => <option key={e}>{e}</option>)}</select>
        <select className="ui-select" aria-label="Channel" value={sel.channel} onChange={(e) => setSel({ ...sel, channel: e.target.value })}><option>whatsapp</option><option>email</option><option>sms</option></select>
        {cur?.custom && <StatusChip tone="info">Edited</StatusChip>}
      </div>
      <div className="ui-split" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <Field label="Message" error={unknown.length ? `Unknown: ${unknown.map((u) => `{${u}}`).join(' ')}` : undefined}>
          <textarea className="ui-input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="ui-preview"><div className="ui-preview-head">Preview</div><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{sample}</pre></div>
      </div>
      <div className="ui-help">Variables: {VARS.map((v) => <button key={v} type="button" className="btn btn-ghost" onClick={() => setBody((b) => `${b}{${v}}`)}>{`{${v}}`}</button>)}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-primary" disabled={!!unknown.length || !body.trim()} onClick={save}>Save</button>
        {cur?.custom && <button type="button" className="btn btn-secondary" onClick={async () => { await api.resetTemplate({ businessId, ...sel, language: 'en' }); await load(); }}>Reset to default</button>}
      </div>
    </div>
  );
}

export default function RemindersPage() {
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { listBusinesses().then((b) => { setBusinesses(b); setBusinessId((c) => c || (b.find((x) => x.isDefault) || b[0])?.id || ''); }).catch(setError); }, []);
  useEffect(() => { if (businessId) api.messagingStatus(businessId).then(setStatus).catch(setError); }, [businessId]);
  if (error) return <ErrorState message={err(error)} onRetry={() => window.location.reload()} />;
  if (!businesses || (businessId && !status)) return <LoadingState label="Opening Reminders…" />;
  return (
    <div>
      <PageHeader icon="🔔" title="Reminders" subtitle="Collect faster: payment reminders, service reminders and your messages" />
      {businesses.length > 1 && (
        <select className="ui-select" aria-label="Business" value={businessId} onChange={(e) => { setStatus(null); setBusinessId(e.target.value); }} style={{ marginBottom: 12 }}>
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {!status?.enabled ? (
        <EmptyState title="Messaging is off" hint="The owner can turn it on in Settings > Txn Message. Nothing is sent or queued while it is off." action={<Link className="btn btn-primary" to="/settings/message?focus=msg.enabled">Open settings</Link>} />
      ) : (
        <UrlTabs tabs={TABS} ariaLabel="Reminders">
          {(tab) => tab === 'payment' ? <PaymentTab businessId={businessId} channels={status.channels} />
            : tab === 'service' ? <ServiceTab businessId={businessId} />
            : tab === 'messages' ? <MessagesTab businessId={businessId} />
            : <TemplatesTab businessId={businessId} />}
        </UrlTabs>
      )}
    </div>
  );
}
