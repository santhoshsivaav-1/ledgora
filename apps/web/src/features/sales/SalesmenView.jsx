import { useEffect, useState } from 'react';
import { Plus, UserCheck } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import Can from '../../components/ui/Can';
import { Field, MoneyInput, Select, Switch, TextInput } from '../../components/ui/Field';
import { PhoneInput } from '../../components/ui/IndiaInputs';
import { StatusChip } from '../../components/ui/Display';
import { EmptyState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { apiClient } from '../../lib/apiClient';
import LocationCard from './LocationCard';
import { formatCurrency, localToday } from '../../utils';
import {
  createStaff,
  deleteStaff,
  listStaff,
  monthRange,
  staffBody,
  staffFormErrors,
  staffPerformance,
  updateStaff,
} from '../../lib/data/staff';

// Vyapar parity P2-S1: the Salesman screen. One row per salesman with this month's target, sales (net of GST and
// returns), money collected and commission, all from GET /v1/staff/:id/performance, so they match the Sale Report
// filtered by salesman. Add / Edit opens a modal; deactivating hides a salesman from the invoice picker.

const blank = { name: '', phone: '', userId: '', commissionPct: 0, monthlyTarget: 0, active: true };

export default function SalesmenView() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloads, setReloads] = useState(0);
  const [form, setForm] = useState(null);
  const [members, setMembers] = useState([]);

  useEffect(() => {
    let live = true;
    const month = monthRange(localToday());
    (async () => {
      try {
        const staff = await listStaff();
        const perf = await Promise.all(
          staff.map((s) => staffPerformance(s.id, month).catch(() => null)),
        );
        if (live) {
          setRows(staff.map((s, i) => ({ ...s, perf: perf[i] })));
          setError(null);
        }
      } catch (e) {
        if (live) setError(e);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [reloads]);

  useEffect(() => {
    apiClient
      .get('/v1/members', { quietForbidden: true })
      .then((r) => setMembers(r.data || []))
      .catch(() => {}); // without team access the form just cannot link a login
  }, []);

  const columns = [
    {
      id: 'name',
      header: 'Name',
      accessor: (r) => r.name,
      sortable: true,
      render: (r) => (
        <span>
          {r.name} {!r.active && <StatusChip tone="neutral">Inactive</StatusChip>}
        </span>
      ),
    },
    { id: 'phone', header: 'Phone', accessor: (r) => r.phone },
    { id: 'target', header: 'Target (month)', align: 'right', accessor: (r) => r.monthlyTarget, render: (r) => formatCurrency(r.monthlyTarget) },
    {
      id: 'sales',
      header: 'Sales this month',
      align: 'right',
      accessor: (r) => r.perf?.netSales ?? 0,
      render: (r) => (r.perf ? `${formatCurrency(r.perf.netSales)}${r.perf.targetPct != null ? ` (${r.perf.targetPct}%)` : ''}` : '–'),
    },
    { id: 'collected', header: 'Collected', align: 'right', accessor: (r) => r.perf?.collected ?? 0, render: (r) => (r.perf ? formatCurrency(r.perf.collected) : '–') },
    { id: 'commission', header: 'Commission', align: 'right', accessor: (r) => r.perf?.commission ?? 0, render: (r) => (r.perf ? formatCurrency(r.perf.commission) : '–') },
  ];

  const remove = async (r) => {
    if (!(await confirmAction({ title: `Remove ${r.name}?`, message: 'Their invoices keep their name. To only hide them from the invoice picker, set them inactive instead.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await deleteStaff(r.id);
      toast(`${r.name} removed`, 'success');
      setReloads((n) => n + 1);
    } catch (e) {
      toast(e.message || 'Could not remove', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        icon={<UserCheck size={20} />}
        title="Salesman"
        subtitle="Targets, sales, collections and commission this month"
        actions={
          <Can do="staff:write">
            <button type="button" className="btn btn-primary" onClick={() => setForm({ ...blank })}>
              <Plus size={16} /> Add Salesman
            </button>
          </Can>
        }
      />
      <LocationCard />
      <DataTable
        id="salesmen"
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={() => setReloads((n) => n + 1)}
        empty={<EmptyState title="No salesmen yet" hint="Add a salesman to credit invoices to them and track their commission." />}
        onRowClick={(r) => setForm({ ...r, userId: r.userId || '' })}
        rowActions={(r) => [
          { label: 'Edit', perm: 'staff:write', onSelect: () => setForm({ ...r, userId: r.userId || '' }) },
          {
            label: r.active ? 'Set inactive' : 'Set active',
            perm: 'staff:write',
            onSelect: () =>
              updateStaff(r.id, { active: !r.active })
                .then(() => setReloads((n) => n + 1))
                .catch((e) => toast(e.message || 'Could not save', 'error')),
          },
          { label: 'Remove', perm: 'staff:write', tone: 'danger', onSelect: () => remove(r) },
        ]}
      />
      {form && (
        <SalesmanModal
          initial={form}
          members={members}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setReloads((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function SalesmanModal({ initial, members, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const e = staffFormErrors(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      if (form.id) await updateStaff(form.id, staffBody(form));
      else await createStaff(staffBody(form));
      toast(`${form.id ? 'Saved' : 'Added'} ${form.name}`, 'success');
      onSaved();
    } catch (err) {
      const fieldErr = Array.isArray(err.details) ? err.details.find((d) => d.path) : null;
      if (fieldErr) setErrors({ [fieldErr.path]: fieldErr.message });
      else toast(err.message || 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };
  const userOptions = members
    .filter((m) => m.role === 'salesman' || m.userId === form.userId)
    .map((m) => ({ value: m.userId, label: `${m.name || m.email} (${m.email})` }));
  return (
    <Modal
      open
      onClose={onClose}
      title={form.id ? `Edit ${initial.name}` : 'Add Salesman'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <Field label="Name" required error={errors.name}>
        <TextInput value={form.name} onChange={set('name')} maxLength={100} autoFocus />
      </Field>
      <Field label="Phone" error={errors.phone}>
        <PhoneInput value={form.phone} onChange={set('phone')} />
      </Field>
      <Field label="Linked login" help="A Salesman login linked here sees only their own invoices." error={errors.userId}>
        <Select value={form.userId || ''} onChange={set('userId')} options={userOptions} placeholder="None" />
      </Field>
      <Field label="Commission %" error={errors.commissionPct} help="On sales net of GST and returns">
        <TextInput value={String(form.commissionPct ?? '')} onChange={set('commissionPct')} inputMode="decimal" />
      </Field>
      <Field label="Monthly target" error={errors.monthlyTarget}>
        <MoneyInput value={form.monthlyTarget} onChange={set('monthlyTarget')} />
      </Field>
      <Switch checked={form.active !== false} onChange={set('active')} label="Active" />
    </Modal>
  );
}
