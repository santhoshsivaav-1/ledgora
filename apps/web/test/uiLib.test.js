import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatQty,
  parseAmount,
  roundTo,
  parseTypedDate,
  isoToDisplay,
  withinBounds,
  normalisePhone,
} from '../src/components/ui/lib/format';
import { periodRange } from '../src/components/ui/lib/period';
import {
  nextSort,
  sortRows,
  columnTotals,
  toggleSelection,
  rowsToTsv,
} from '../src/components/ui/lib/table';
import { lineColumnsFor, parsePastedRows, nextCell } from '../src/components/ui/lib/grid';
import { trapIndex } from '../src/components/ui/lib/focus';
import { gstinHint } from '../src/components/ui/IndiaInputs';
import { initialParams, searchRows } from '../src/components/ui/ReportShell';

// Vyapar parity Phase 0, P0-S3: the logic inside the shared components.

describe('money and quantity inputs', () => {
  it('reads Indian and plain numbers', () => {
    expect(parseAmount('1,23,456.50')).toBe(123456.5);
    expect(parseAmount('123456.5')).toBe(123456.5);
    expect(parseAmount('₹ 500')).toBe(500);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('12a')).toBeNaN();
    expect(parseAmount('-20')).toBeNaN();
    expect(parseAmount('-20', { allowNegative: true })).toBe(-20);
  });

  it('formats with Indian grouping and rounds like money', () => {
    expect(formatMoney(123456.5)).toBe('1,23,456.50');
    expect(formatMoney('')).toBe('');
    expect(formatQty(2.5)).toBe('2.5');
    expect(formatQty(2.12345)).toBe('2.123');
    expect(roundTo(1.005)).toBe(1.01);
    expect(roundTo(-1.005)).toBe(-1.01);
    expect(roundTo(0.0000001)).toBe(0);
    expect(roundTo(2.345, 1)).toBe(2.3);
  });

  it('keeps ten digits of a mobile number', () => {
    expect(normalisePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalisePhone('98765')).toBe('98765');
  });
});

describe('date input', () => {
  it('reads typed dates in every common shape', () => {
    expect(parseTypedDate('060126')).toBe('2026-01-06');
    expect(parseTypedDate('06012026')).toBe('2026-01-06');
    expect(parseTypedDate('6/1/2026')).toBe('2026-01-06');
    expect(parseTypedDate('06-01-26')).toBe('2026-01-06');
    expect(parseTypedDate('31-02-2026')).toBeNull();
    expect(parseTypedDate('hello')).toBeNull();
    expect(isoToDisplay('2026-01-06')).toBe('06-01-2026');
  });

  it('respects the FY lock', () => {
    expect(withinBounds('2026-04-01', '2026-04-01', '2027-03-31')).toBe(true);
    expect(withinBounds('2026-03-31', '2026-04-01', '2027-03-31')).toBe(false);
  });
});

describe('period presets', () => {
  const today = new Date(2026, 10, 8); // Sunday 8 Nov 2026
  const r = (id, extra) => periodRange(id, { today, ...extra });
  it('follows the calendar and the April FY', () => {
    expect(r('today')).toMatchObject({ from: '2026-11-08', to: '2026-11-08' });
    expect(r('this-week')).toMatchObject({ from: '2026-11-02', to: '2026-11-08' });
    expect(r('this-month')).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    expect(r('last-month')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(r('this-quarter')).toMatchObject({ from: '2026-10-01', to: '2026-12-31' });
    expect(r('last-quarter')).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(r('this-fy')).toMatchObject({ from: '2026-04-01', to: '2027-03-31' });
    expect(r('last-fy')).toMatchObject({ from: '2025-04-01', to: '2026-03-31' });
  });
  it('lets the top bar FY choose This FY', () => {
    expect(r('this-fy', { fyStart: 2024 })).toMatchObject({ from: '2024-04-01', to: '2025-03-31' });
  });
  it('handles the first FY quarter across the year end', () => {
    expect(periodRange('this-quarter', { today: new Date(2027, 1, 10) })).toMatchObject({
      from: '2027-01-01',
      to: '2027-03-31',
    });
    expect(periodRange('last-quarter', { today: new Date(2027, 1, 10) })).toMatchObject({
      from: '2026-10-01',
      to: '2026-12-31',
    });
  });
});

describe('DataTable logic', () => {
  const cols = [
    { id: 'name', accessor: 'name' },
    { id: 'amt', accessor: 'amt', total: 'sum' },
    { id: 'n', accessor: (r) => r.amt * 2, total: (rows) => rows.length },
  ];
  const rows = [
    { id: 1, name: 'b', amt: 0.1 },
    { id: 2, name: 'A', amt: -5 },
    { id: 3, name: '', amt: 0.2 },
    { id: 4, name: 'c', amt: 10 },
  ];

  it('cycles sort asc → desc → off', () => {
    expect(nextSort(null, 'name')).toEqual({ id: 'name', dir: 'asc' });
    expect(nextSort({ id: 'name', dir: 'asc' }, 'name')).toEqual({ id: 'name', dir: 'desc' });
    expect(nextSort({ id: 'name', dir: 'desc' }, 'name')).toBeNull();
    expect(nextSort({ id: 'name', dir: 'desc' }, 'amt')).toEqual({ id: 'amt', dir: 'asc' });
  });

  it('sorts text without case, numbers by value, blanks last', () => {
    expect(sortRows(rows, cols, { id: 'name', dir: 'asc' }).map((r) => r.id)).toEqual([2, 1, 4, 3]);
    expect(sortRows(rows, cols, { id: 'name', dir: 'desc' }).map((r) => r.id)).toEqual([
      4, 1, 2, 3,
    ]);
    expect(sortRows(rows, cols, { id: 'amt', dir: 'asc' }).map((r) => r.id)).toEqual([2, 1, 3, 4]);
    expect(sortRows(rows, cols, null)).toBe(rows);
  });

  it('totals negative and fractional amounts to the paisa', () => {
    expect(columnTotals(rows, cols)).toEqual({ amt: 5.3, n: 4 });
    expect(columnTotals([{ amt: 0.1 }, { amt: 0.2 }], cols).amt).toBe(0.3);
  });

  it('selects ranges with shift-click', () => {
    const keys = [1, 2, 3, 4, 5];
    let sel = toggleSelection(new Set(), keys, 2);
    expect([...sel]).toEqual([2]);
    sel = toggleSelection(sel, keys, 4, { shift: true, anchor: 2 });
    expect([...sel].sort()).toEqual([2, 3, 4]);
    sel = toggleSelection(sel, keys, 3);
    expect([...sel].sort()).toEqual([2, 4]);
  });

  it('copies rows as tab-separated text', () => {
    expect(
      rowsToTsv(
        [{ name: 'a\tb', amt: 1 }],
        [
          { id: 'name', header: 'Name' },
          { id: 'amt', header: 'Amt' },
        ],
      ),
    ).toBe('Name\tAmt\na b\t1');
  });
});

describe('LinesGrid logic', () => {
  it('shows the columns of each document type', () => {
    expect(lineColumnsFor('sale')).not.toContain('itc');
    expect(lineColumnsFor('purchase')).toContain('itc');
    expect(lineColumnsFor('return')).not.toContain('discount');
    expect(lineColumnsFor('sale', { batch: true })).toEqual([
      'item',
      'hsn',
      'batch',
      'qty',
      'unit',
      'rate',
      'discount',
      'gst',
      'amount',
    ]);
    expect(lineColumnsFor('order', { batch: true })).not.toContain('batch');
  });

  it('pastes rows from Excel', () => {
    expect(parsePastedRows('Rod\t7214\t10\nNut\t7318\t50\n', ['item', 'hsn', 'qty'])).toEqual([
      { item: 'Rod', hsn: '7214', qty: '10' },
      { item: 'Nut', hsn: '7318', qty: '50' },
    ]);
    expect(parsePastedRows('just one value', ['item'])).toBeNull();
    expect(parsePastedRows('a\tb', ['item', 'hsn'])).toEqual([{ item: 'a', hsn: 'b' }]);
  });

  it('moves like a spreadsheet and adds a row from the last cell', () => {
    const size = { rows: 2, cols: 3 };
    expect(nextCell({ row: 0, col: 2 }, size, 'Tab')).toEqual({ row: 1, col: 0 });
    expect(nextCell({ row: 1, col: 0 }, size, 'Tab', true)).toEqual({ row: 0, col: 2 });
    expect(nextCell({ row: 1, col: 2 }, size, 'Enter')).toEqual({ row: 2, col: 0, addRow: true });
    expect(nextCell({ row: 1, col: 2 }, size, 'Tab')).toEqual({ row: 1, col: 2 });
  });
});

describe('focus trap', () => {
  it('wraps Tab inside the dialog', () => {
    expect(trapIndex(2, 3, false)).toBe(0);
    expect(trapIndex(0, 3, true)).toBe(2);
    expect(trapIndex(-1, 3, false)).toBe(0);
    expect(trapIndex(-1, 3, true)).toBe(2);
    expect(trapIndex(1, 3, false)).toBe(2);
    expect(trapIndex(0, 0, false)).toBe(-1);
  });
});

describe('GSTIN box', () => {
  it('names the state after two digits and checks the check digit', () => {
    expect(gstinHint('2')).toEqual({ tone: 'muted', text: '' });
    expect(gstinHint('29AB')).toEqual({ tone: 'muted', text: 'Karnataka' });
    expect(gstinHint('00')).toMatchObject({ tone: 'error' });
    expect(gstinHint('27AAPFU0939F1ZV')).toMatchObject({ tone: 'ok', text: 'Maharashtra' });
    expect(gstinHint('27AAPFU0939F1ZA')).toMatchObject({ tone: 'error' });
  });
});

describe('ReportShell', () => {
  it('starts each filter on its default', () => {
    const def = {
      filters: [
        { kind: 'period', default: 'this-fy' },
        { kind: 'select', id: 'type', options: [{ value: 'all' }] },
        { kind: 'toggle', id: 'zero' },
        { kind: 'search' },
      ],
    };
    const p = initialParams(def, { today: new Date(2026, 10, 8) });
    expect(p.period).toMatchObject({ id: 'this-fy', from: '2026-04-01' });
    expect(p).toMatchObject({ type: 'all', zero: false, q: '' });
  });
  it('searches the shown columns', () => {
    const cols = [{ id: 'party', accessor: 'party' }];
    expect(searchRows([{ party: 'Ravi' }, { party: 'Meena' }], cols, 'rav')).toEqual([
      { party: 'Ravi' },
    ]);
  });
});
