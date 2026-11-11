import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, FileDown, Star, Trash2 } from 'lucide-react';
import Can from '../../components/ui/Can';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import {
  createSchedule,
  deleteSchedule,
  deleteView,
  downloadReportCsv,
  listSchedules,
  patchSchedule,
  saveView,
  setFavourite,
} from '../../lib/data/reports';

// Vyapar parity P6-S8: what sits beside Export on a report: the star (favourite), saved views (named filter sets, restored
// exactly), the full CSV from the server (every row, not just the page) and the e-mail schedule of a server report.

const errText = (e) => e?.body?.error?.message || e?.message || 'Something went wrong';
const small = { padding: '0.25rem 0.6rem', fontSize: '0.78rem' };

function Dialog({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-label={title}
      >
        <h3 className="section-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function ReportTools({
  reportId,
  businessId,
  server,
  prefs,
  onPrefs,
  getParams,
  onApplyView,
}) {
  const [dlg, setDlg] = useState(null);
  const starred = prefs.favourites.includes(reportId);
  const views = prefs.views.filter((v) => v.reportId === reportId);

  const star = async () => {
    try {
      onPrefs(await setFavourite(reportId, !starred));
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  const csv = async () => {
    try {
      const r = await downloadReportCsv(reportId, businessId, getParams());
      toast(
        r.truncated
          ? `Downloaded the first ${r.rows.toLocaleString('en-IN')} rows (the report has more; narrow the period)`
          : `Downloaded ${r.rows.toLocaleString('en-IN')} rows`,
        r.truncated ? 'warning' : 'success',
      );
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        style={small}
        onClick={star}
        aria-pressed={starred}
        aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
        title={starred ? 'Starred' : 'Star this report'}
      >
        <Star size={14} fill={starred ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
      {views.length > 0 && (
        <select
          className="filter-select"
          value=""
          aria-label="Saved views"
          onChange={(e) => {
            const v = views.find((x) => x.id === e.target.value);
            if (v) onApplyView(v);
          }}
        >
          <option value="">Saved views…</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        style={small}
        onClick={() => setDlg({ kind: 'view', name: '' })}
      >
        Save view
      </button>
      {server && (
        <>
          <Can do="data:export">
            <button
              type="button"
              className="btn btn-secondary"
              style={small}
              onClick={csv}
              title="Every row, from the server"
            >
              <FileDown size={14} aria-hidden="true" /> Full CSV
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={small}
              onClick={() => setDlg({ kind: 'schedule' })}
            >
              <CalendarClock size={14} aria-hidden="true" /> Schedule
            </button>
          </Can>
        </>
      )}
      {dlg?.kind === 'view' && (
        <Dialog title="Save this view" onClose={() => setDlg(null)}>
          <p className="field-hint">
            Keeps the period and filters as they are now, so you can open the report like this
            again. Saving under a name you already have replaces it.
          </p>
          <input
            className="form-input"
            autoFocus
            placeholder="Name, e.g. Asha — this year"
            value={dlg.name}
            onChange={(e) => setDlg({ ...dlg, name: e.target.value })}
          />
          {views.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
              {views.map((v) => (
                <li
                  key={v.id}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  {v.name}
                  <button
                    className="icon-btn icon-btn-red"
                    aria-label={`Delete view ${v.name}`}
                    onClick={async () => {
                      try {
                        onPrefs(await deleteView(v.id));
                      } catch (e) {
                        toast(errText(e), 'error');
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 justify-end mt-4">
            <button className="btn btn-secondary" onClick={() => setDlg(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!dlg.name.trim()}
              onClick={async () => {
                try {
                  onPrefs(await saveView({ name: dlg.name.trim(), reportId, params: getParams() }));
                  toast('View saved', 'success');
                  setDlg(null);
                } catch (e) {
                  toast(errText(e), 'error');
                }
              }}
            >
              Save
            </button>
          </div>
        </Dialog>
      )}
      {dlg?.kind === 'schedule' && (
        <ScheduleDialog
          reportId={reportId}
          businessId={businessId}
          params={getParams()}
          onClose={() => setDlg(null)}
        />
      )}
    </>
  );
}

function ScheduleDialog({ reportId, businessId, params, onClose }) {
  const [list, setList] = useState(null);
  const [f, setF] = useState({ frequency: 'weekly', recipients: '' });
  const load = useCallback(
    () =>
      listSchedules(businessId)
        .then((all) => setList(all.filter((s) => s.reportId === reportId)))
        .catch((e) => toast(errText(e), 'error')),
    [businessId, reportId],
  );
  useEffect(() => {
    load();
  }, [load]);
  // The period is the schedule's (the week or month before); the other filters are kept as they are now.
  const filters = Object.fromEntries(
    Object.entries(params)
      .filter(([k, v]) => k !== 'period' && k !== 'q' && v !== '' && v != null)
      .map(([k, v]) => [k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)]),
  );
  const emails = f.recipients.split(/[\s,;]+/).filter(Boolean);
  const create = async () => {
    try {
      await createSchedule({
        businessId,
        reportId,
        params: filters,
        frequency: f.frequency,
        recipients: emails,
      });
      toast('Scheduled', 'success');
      setF({ ...f, recipients: '' });
      load();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  return (
    <Dialog title="E-mail this report" onClose={onClose}>
      <p className="field-hint">
        Sends the report as a CSV file: every Monday (the week before) or on the 1st (the month
        before), once for each period. It uses the filters set now, not the period.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="form-group">
          <label className="form-label">How often</label>
          <select
            className="form-input"
            value={f.frequency}
            onChange={(e) => setF({ ...f, frequency: e.target.value })}
          >
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">To (e-mail addresses)</label>
          <input
            className="form-input"
            value={f.recipients}
            onChange={(e) => setF({ ...f, recipients: e.target.value })}
            placeholder="owner@shop.in, ca@firm.in"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button className="btn btn-primary" disabled={!emails.length} onClick={create}>
          Add schedule
        </button>
      </div>
      {list?.length > 0 && (
        <table className="data-table" style={{ minWidth: 0, marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>When</th>
              <th>To</th>
              <th>Last sent</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                <td>{s.frequency}</td>
                <td>{s.recipients.join(', ')}</td>
                <td>
                  {s.lastPeriod ?? 'not yet'}
                  {s.lastError && <span style={{ color: '#dc2626' }}> · {s.lastError}</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="btn btn-secondary"
                    style={small}
                    onClick={async () => {
                      try {
                        await patchSchedule(s.id, { active: !s.active });
                        load();
                      } catch (e) {
                        toast(errText(e), 'error');
                      }
                    }}
                  >
                    {s.active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    className="icon-btn icon-btn-red"
                    aria-label="Delete schedule"
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: 'Stop this schedule?',
                          message: 'No more e-mails will be sent for it.',
                          confirmLabel: 'Stop',
                          tone: 'danger',
                        })
                      ) {
                        try {
                          await deleteSchedule(s.id);
                          load();
                        } catch (e) {
                          toast(errText(e), 'error');
                        }
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
