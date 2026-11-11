import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import PageHeader from './PageHeader';
import DataTable from './DataTable';
import ExportMenu from './ExportMenu';
import { FilterBar, PeriodPicker, SearchInput, SummaryChips } from './FilterBar';
import { Select, Switch } from './Field';
import { periodRange } from './lib/period';
import { cellValue } from './lib/table';

// The template every report uses (P0-S3.7, built out in Phase 6): a ReportDef describes the report and this draws
// the title bar with Export, the filters, the summary chips and the table with its totals row.
//
// type ReportDef = {
//   id, title, group, description?,
//   filters: FilterSpec[],       // { kind: 'period' } | { kind: 'select', id, label, options } | { kind: 'toggle', id, label } | { kind: 'search' }
//   columns: ColumnSpec[],       // DataTable columns
//   summary?: (rows, totals, meta) => Chip[],   // totals and meta as the server sent them (Phase 6: server totals)
//   fetch: (params) => Promise<{ rows, totals?, meta? }>,
//   drilldown?: (row) => string | null,   // a route to open for the row
//   exports: ('pdf'|'xlsx'|'print'|'share')[],
// }

/** The starting filter values a ReportDef asks for: This month for a period, the first option of a select. */
export function initialParams(def, { fyStartMonth = 4, today } = {}) {
  const params = {};
  for (const f of def.filters || []) {
    if (f.kind === 'period')
      params.period = periodRange(f.default || 'this-month', { fyStartMonth, today });
    else if (f.kind === 'select') params[f.id] = f.default ?? f.options?.[0]?.value ?? '';
    else if (f.kind === 'toggle') params[f.id] = !!f.default;
    else if (f.kind === 'search') params.q = '';
  }
  return params;
}

/** Rows that contain the search text in any shown column (search runs on the rows already fetched). */
export const searchRows = (rows, columns, q) => {
  const needle = String(q || '')
    .trim()
    .toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) =>
    columns.some((c) =>
      String(cellValue(c, r) ?? '')
        .toLowerCase()
        .includes(needle),
    ),
  );
};

const EXPORT_FORMATS = { pdf: 'print', print: 'print', xlsx: 'xlsx', share: 'share', csv: 'csv' };

// Props beyond the definition (Phase 6): `initial` filter values to start from (a saved view), `onParams` told whenever the
// filters change (so a screen can save them), `headerExtra` beside Export (star, save view, schedule) and `businessLine`
// (business name, GSTIN) printed under the title of an export.
export default function ReportShell({
  def,
  fyStartMonth = 4,
  breadcrumb,
  initial,
  onParams,
  headerExtra,
  businessLine,
}) {
  const navigate = useNavigate();
  const [params, setParams] = useState(() => ({
    ...initialParams(def, { fyStartMonth }),
    ...(initial || {}),
  }));
  useEffect(() => {
    onParams?.(params);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState({
    loading: true,
    error: null,
    rows: [],
    meta: null,
    totals: null,
  });
  const { q, ...fetchParams } = params;
  const fetchKey = JSON.stringify(fetchParams);

  const load = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve(def.fetch(JSON.parse(fetchKey)))
      .then(
        (res) =>
          live &&
          setState({
            loading: false,
            error: null,
            rows: res?.rows || [],
            meta: res?.meta || null,
            totals: res?.totals || null,
          }),
      )
      .catch(
        (err) =>
          live &&
          setState({
            loading: false,
            error: err?.body?.error?.message || err?.message || 'Could not load this report',
            rows: [],
            meta: null,
            totals: null,
          }),
      );
    return () => {
      live = false;
    };
  }, [def, fetchKey]);
  useEffect(load, [load]);

  const rows = useMemo(() => searchRows(state.rows, def.columns, q), [state.rows, def.columns, q]);
  const set = (k, v) => setParams((p) => ({ ...p, [k]: v }));
  const subtitle = [
    businessLine,
    params.period ? `${params.period.label}: ${params.period.from} to ${params.period.to}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const formats = [...new Set((def.exports || []).map((e) => EXPORT_FORMATS[e]).filter(Boolean))];

  return (
    <div className="ui-report">
      <PageHeader
        compact
        title={def.title}
        breadcrumb={breadcrumb || [{ label: 'Reports', to: '/reports' }, { label: def.title }]}
        actions={
          <>
            {headerExtra}
            {formats.length > 0 && (
              <ExportMenu
                title={def.title}
                subtitle={subtitle}
                filename={def.id}
                formats={formats}
                headers={def.columns.map((c) => (typeof c.header === 'string' ? c.header : c.id))}
                getRows={() => rows.map((r) => def.columns.map((c) => cellValue(c, r) ?? ''))}
              />
            )}
          </>
        }
      />
      {def.description && (
        <p className="ui-help" style={{ margin: '0 0 var(--s-3)' }}>
          {def.description}
        </p>
      )}
      <FilterBar>
        {(def.filters || []).map((f) => {
          if (f.kind === 'period')
            return (
              <PeriodPicker
                key="period"
                value={params.period}
                onChange={(v) => set('period', v)}
                fyStartMonth={fyStartMonth}
              />
            );
          if (f.kind === 'select')
            return (
              <Select
                key={f.id}
                aria-label={f.label}
                value={params[f.id]}
                options={f.options}
                onChange={(v) => set(f.id, v)}
              />
            );
          if (f.kind === 'toggle')
            return (
              <Switch
                key={f.id}
                label={f.label}
                checked={params[f.id]}
                onChange={(v) => set(f.id, v)}
              />
            );
          if (f.kind === 'search')
            return <SearchInput key="search" value={q} onChange={(v) => set('q', v)} />;
          return null;
        })}
      </FilterBar>
      {def.summary && !state.loading && !state.error && (
        <SummaryChips chips={def.summary(rows, state.totals || {}, state.meta || {})} />
      )}
      <DataTable
        id={`report.${def.id}`}
        columns={def.columns}
        rows={rows}
        rowKey={(r) => r.id ?? JSON.stringify(r)}
        loading={state.loading}
        error={state.error}
        onRetry={load}
        columnPicker
        stickyFirstColumn
        hiddenByFilters={state.rows.length - rows.length}
        onClearFilters={() => set('q', '')}
        onRowClick={
          def.drilldown
            ? (r) => {
                const to = def.drilldown(r);
                if (to) navigate(to);
              }
            : undefined
        }
        caption={def.title}
      />
    </div>
  );
}
