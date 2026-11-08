import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Rows3 } from 'lucide-react';
import { EmptyState, ErrorState } from './States';
import { Skeleton } from './Display';
import Menu from './Menu';
import ExportMenu from './ExportMenu';
import { formatMoney } from './lib/format';
import { cellValue, columnTotals, loadHiddenColumns, nextSort, saveHiddenColumns, sortRows, toggleSelection } from './lib/table';

// The one table every list and report uses (Vyapar parity P0-S3.1): sortable headers, sticky head and totals row,
// row selection with shift-click ranges, a column picker remembered per table, the ⋮ row menu, cursor paging that
// matches the API's listPage(), and the loading / empty / error states.
//
// columns: { id, header, accessor?, align?: 'left'|'right'|'center', width?, sortable?, render?(row), total?: 'sum'|fn,
//            format?: 'money', hideable? }
// Sorting is local unless `onSort` is given (then `sort` is controlled and the server sorts).

const alignClass = (c) => (c.align === 'right' || c.format === 'money' ? 'ui-num' : c.align === 'center' ? 'ui-center' : undefined);

function renderCell(c, row) {
  if (c.render) return c.render(row);
  const v = cellValue(c, row);
  if (c.format === 'money') return formatMoney(v);
  return v ?? '';
}

export default function DataTable({
  id,
  columns,
  rows = [],
  rowKey = (r) => r.id,
  loading = false,
  error = null,
  onRetry,
  empty,
  selectable = false,
  selected: selectedProp,
  onSelectedChange,
  sort: sortProp,
  onSort,
  pagination,
  rowActions,
  onRowClick,
  density: densityProp,
  columnPicker = false,
  stickyFirstColumn = false,
  exportable,
  hiddenByFilters = 0,
  onClearFilters,
  toolbar,
  caption,
}) {
  const [localSort, setLocalSort] = useState(null);
  const sort = onSort ? sortProp : localSort;
  const [density, setDensity] = useState(densityProp || 'comfortable');
  const [hidden, setHidden] = useState(() => loadHiddenColumns(id));
  const [localSelected, setLocalSelected] = useState(() => new Set());
  const selected = selectedProp || localSelected;
  const setSelected = onSelectedChange || setLocalSelected;
  const anchor = useRef(null);

  const shown = useMemo(() => columns.filter((c) => !hidden.includes(c.id)), [columns, hidden]);
  const sorted = useMemo(() => (onSort ? rows : sortRows(rows, columns, sort)), [rows, columns, sort, onSort]);
  const keys = useMemo(() => sorted.map(rowKey), [sorted, rowKey]);
  const totals = useMemo(() => columnTotals(sorted, shown), [sorted, shown]);
  const hasTotals = shown.some((c) => c.total);
  const allOn = keys.length > 0 && keys.every((k) => selected.has(k));

  const clickSort = (c) => {
    const next = nextSort(sort, c.id);
    if (onSort) onSort(next);
    else setLocalSort(next);
  };

  const toggleColumn = (colId) => {
    const next = hidden.includes(colId) ? hidden.filter((h) => h !== colId) : [...hidden, colId];
    setHidden(next);
    saveHiddenColumns(id, next);
  };

  const colSpan = shown.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);
  const exportRows = () => sorted.map((r) => shown.map((c) => cellValue(c, r) ?? ''));

  const showToolbar = toolbar || columnPicker || exportable || (selectable && selected.size > 0) || densityProp === undefined;

  let body;
  if (loading) {
    body = Array.from({ length: 8 }, (_, i) => (
      <tr key={`sk${i}`}>
        {Array.from({ length: colSpan }, (__, j) => (
          <td key={j}>
            <Skeleton width={j === 0 ? '70%' : '50%'} />
          </td>
        ))}
      </tr>
    ));
  } else if (error) {
    body = (
      <tr>
        <td colSpan={colSpan}>
          <ErrorState message={typeof error === 'string' ? error : error?.message} onRetry={onRetry} />
        </td>
      </tr>
    );
  } else if (sorted.length === 0) {
    body = (
      <tr>
        <td colSpan={colSpan}>{empty || <EmptyState title="Nothing here yet" />}</td>
      </tr>
    );
  } else {
    body = sorted.map((r, i) => {
      const k = keys[i];
      const isOn = selected.has(k);
      return (
        <tr
          key={k}
          aria-selected={selectable ? isOn : undefined}
          data-clickable={!!onRowClick || undefined}
          onClick={onRowClick ? (e) => !e.target.closest('input, button, a, .ui-menu') && onRowClick(r) : undefined}
        >
          {selectable && (
            <td className="ui-col-check">
              <input
                type="checkbox"
                checked={isOn}
                aria-label="Select row"
                onClick={(e) => {
                  setSelected(toggleSelection(selected, keys, k, { shift: e.shiftKey, anchor: anchor.current }));
                  anchor.current = k;
                }}
                onChange={() => {}}
              />
            </td>
          )}
          {shown.map((c) => (
            <td key={c.id} className={alignClass(c)} style={c.width ? { width: c.width } : undefined}>
              {renderCell(c, r)}
            </td>
          ))}
          {rowActions && (
            <td className="ui-col-menu">
              <Menu items={rowActions(r)} label="Row actions" />
            </td>
          )}
        </tr>
      );
    });
  }

  return (
    <div className="ui-table-wrap">
      {showToolbar && (
        <div className="ui-table-toolbar">
          {selectable && selected.size > 0 && (
            <span className="ui-help" aria-live="polite">
              {selected.size} selected
            </span>
          )}
          {toolbar}
          <div className="ui-table-toolbar-right">
            {columnPicker && (
              <Menu
                label="Columns"
                trigger={
                  <>
                    <Columns3 size={15} aria-hidden="true" /> Columns
                  </>
                }
                items={columns
                  .filter((c) => c.hideable !== false)
                  .map((c) => ({
                    label: `${hidden.includes(c.id) ? '☐' : '☑'} ${typeof c.header === 'string' ? c.header : c.id}`,
                    onSelect: () => toggleColumn(c.id),
                  }))}
              />
            )}
            {densityProp === undefined && (
              <button
                type="button"
                className="ui-icon-btn"
                aria-pressed={density === 'compact'}
                aria-label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
                title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
                onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
              >
                <Rows3 size={16} />
              </button>
            )}
            {exportable && <ExportMenu title={exportable.title || exportable.filename} filename={exportable.filename} headers={shown.map((c) => (typeof c.header === 'string' ? c.header : c.id))} getRows={exportRows} />}
          </div>
        </div>
      )}
      {hiddenByFilters > 0 && (
        <div className="ui-table-note">
          {hiddenByFilters} hidden by filters.{' '}
          {onClearFilters && (
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onClearFilters}>
              Clear
            </button>
          )}
        </div>
      )}
      <div className="ui-table-scroll">
        <table className="ui-table" data-density={densityProp || density} data-sticky-first={stickyFirstColumn || undefined}>
          {caption && <caption className="ui-visually-hidden">{caption}</caption>}
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="ui-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={allOn}
                    onChange={() => setSelected(allOn ? new Set() : new Set(keys))}
                  />
                </th>
              )}
              {shown.map((c) => {
                const dir = sort?.id === c.id ? sort.dir : null;
                const ariaSort = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : c.sortable ? 'none' : undefined;
                const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
                return (
                  <th key={c.id} scope="col" className={alignClass(c)} aria-sort={ariaSort} style={c.width ? { width: c.width } : undefined}>
                    {c.sortable ? (
                      <button type="button" className="ui-sort" onClick={() => clickSort(c)}>
                        {c.header}
                        <Icon size={12} aria-hidden="true" style={{ opacity: dir ? 1 : 0.4 }} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="ui-col-menu">
                  <span className="ui-visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>{body}</tbody>
          {hasTotals && !loading && !error && sorted.length > 0 && (
            <tfoot>
              <tr>
                {selectable && <td />}
                {shown.map((c, i) => (
                  <td key={c.id} className={alignClass(c)}>
                    {c.total ? (c.format === 'money' ? formatMoney(totals[c.id]) : totals[c.id]) : i === 0 ? 'Total' : ''}
                  </td>
                ))}
                {rowActions && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pagination && (
        <div className="ui-table-foot">
          <span>{pagination.summary || `${sorted.length} rows`}</span>
          <div className="ui-table-foot-right">
            {pagination.onPageSize && (
              <label className="ui-help">
                Rows{' '}
                <select className="ui-select" style={{ width: 'auto', minHeight: 30 }} value={pagination.pageSize || 50} onChange={(e) => pagination.onPageSize(Number(e.target.value))}>
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="ui-icon-btn" aria-label="Previous page" disabled={!pagination.onPrev || pagination.hasPrev === false} onClick={pagination.onPrev}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="ui-icon-btn" aria-label="Next page" disabled={!pagination.cursor || !pagination.onNext} onClick={() => pagination.onNext(pagination.cursor)}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
