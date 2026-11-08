import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import DataTable from '../src/components/ui/DataTable';
import { Field, MoneyInput, TextInput, RadioCards } from '../src/components/ui/Field';
import DateInput from '../src/components/ui/DateInput';
import Combobox from '../src/components/ui/Combobox';
import { GstinInput } from '../src/components/ui/IndiaInputs';
import LinesGrid, { blankLine } from '../src/components/ui/LinesGrid';
import { Stepper, TabStrip } from '../src/components/ui/Tabs';
import { Money, PaymentStatusChip } from '../src/components/ui/Display';
import { EmptyState } from '../src/components/ui/States';
import { FilterBar, SummaryChips } from '../src/components/ui/FilterBar';
import NavItem from '../src/app/nav/NavItem';
import BusinessNameField, { profileIncomplete } from '../src/app/BusinessNameField';
import PageHeader from '../src/components/ui/PageHeader';

// Vyapar parity Phase 0, P0-S3.8: the shared components' markup, rendered on the server (no DOM in this test
// environment; the interaction logic is covered in uiLib.test.js).

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

const cols = [
  { id: 'party', header: 'Party', sortable: true },
  { id: 'amount', header: 'Amount', format: 'money', total: 'sum' },
];
const rows = [
  { id: 'a', party: 'Ravi', amount: 1000 },
  { id: 'b', party: 'Meena', amount: -250.5 },
];

describe('DataTable', () => {
  it('renders a real table with header scopes, sort state and a sticky totals row', () => {
    const out = html(h(DataTable, { columns: cols, rows, density: 'comfortable' }));
    expect(out).toContain('<table class="ui-table"');
    expect(out).toContain('scope="col"');
    expect(out).toContain('aria-sort="none"');
    expect(out).toContain('<tfoot>');
    expect(out).toContain('749.50'); // 1000 - 250.50
    expect(out).toContain('1,000.00');
  });

  it('shows skeleton rows while loading, and no totals', () => {
    const out = html(h(DataTable, { columns: cols, rows, loading: true, density: 'comfortable' }));
    expect(out.match(/ui-skel/g)).toHaveLength(16); // 8 rows × 2 columns
    expect(out).not.toContain('<tfoot>');
    expect(out).toContain('aria-busy="true"');
  });

  it('tells empty from error', () => {
    const empty = html(
      h(DataTable, {
        columns: cols,
        rows: [],
        density: 'comfortable',
        empty: h(EmptyState, { title: 'No invoices yet' }),
      }),
    );
    expect(empty).toContain('No invoices yet');
    expect(empty).not.toContain('role="alert"');
    const failed = html(
      h(DataTable, {
        columns: cols,
        rows: [],
        density: 'comfortable',
        error: 'Server down',
        onRetry: () => {},
      }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Server down');
    expect(failed).toContain('Try again');
  });

  it('adds a select-all box and per-row boxes when selectable', () => {
    const out = html(
      h(DataTable, { columns: cols, rows, selectable: true, density: 'comfortable' }),
    );
    expect(out).toContain('aria-label="Select all rows"');
    expect(out.match(/aria-label="Select row"/g)).toHaveLength(2);
  });
});

describe('form primitives', () => {
  it('wires label, required mark and error to the input', () => {
    const out = html(
      h(
        Field,
        { label: 'Customer Name', required: true, error: 'Required', id: 'cn' },
        h(TextInput, { value: '', onChange: () => {} }),
      ),
    );
    expect(out).toContain('for="cn"');
    expect(out).toContain('id="cn"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="cn-err"');
    expect(out).toContain('class="ui-req"');
    expect(out).toContain('role="alert"');
  });

  it('shows money with Indian grouping and a rupee sign', () => {
    const out = html(h(MoneyInput, { value: 123456.5, onChange: () => {} }));
    expect(out).toContain('value="1,23,456.50"');
    expect(out).toContain('₹');
    expect(out).toMatch(/inputmode="decimal"/i);
  });

  it('shows ISO dates as dd-mm-yyyy', () => {
    expect(html(h(DateInput, { value: '2026-01-06', onChange: () => {} }))).toContain(
      'value="06-01-2026"',
    );
  });

  it('marks the combobox for assistive tech', () => {
    const out = html(
      h(Combobox, { value: { id: 1, label: 'Ravi' }, search: () => [], onChange: () => {} }),
    );
    expect(out).toContain('role="combobox"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('value="Ravi"');
  });

  it('names the state under a GSTIN and keeps Get Details off without a provider', () => {
    const out = html(h(GstinInput, { value: '29AB', onChange: () => {} }));
    expect(out).toContain('Karnataka');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Get Details/);
  });

  it('draws radio cards as a radiogroup with the choice marked', () => {
    const out = html(
      h(RadioCards, {
        value: 'b',
        onChange: () => {},
        ariaLabel: 'Type',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      }),
    );
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('data-checked="true"');
  });
});

describe('document and display components', () => {
  it('LinesGrid labels every cell and shows the caller’s amount', () => {
    const out = html(
      h(LinesGrid, {
        docType: 'purchase',
        lines: [{ ...blankLine(), item: 'Rod', qty: 2, rate: 50 }],
        onChange: () => {},
        amountOf: () => 118,
      }),
    );
    expect(out).toContain('aria-label="Item, line 1"');
    expect(out).toContain('ITC');
    expect(out).toContain('118.00');
  });

  it('Stepper and tabs carry their ARIA state', () => {
    const steps = html(h(Stepper, { steps: ['Upload', 'Map', 'Import'], current: 1 }));
    expect(steps).toContain('aria-current="step"');
    expect(steps).toContain('data-state="done"');
    const tabs = html(
      h(TabStrip, {
        tabs: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        value: 'b',
        onChange: () => {},
      }),
    );
    expect(tabs).toContain('role="tablist"');
    expect(tabs.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it('colours payment status and signed money', () => {
    expect(html(h(PaymentStatusChip, { status: 'overdue' }))).toContain('data-outline="true"');
    expect(html(h(Money, { value: -5, signed: true }))).toContain('ui-neg');
    expect(html(h(Money, { value: -5, signed: true }))).toContain('−₹5.00');
  });

  it('summary chips print rupees and tones', () => {
    const out = html(
      h(
        FilterBar,
        null,
        h(SummaryChips, { chips: [{ label: 'Unpaid', value: 170000, tone: 'neg' }] }),
      ),
    );
    expect(out).toContain('₹1,70,000.00');
    expect(out).toContain('data-tone="neg"');
    expect(out).toContain('role="search"');
  });

  it('PageHeader keeps its old look and adds a breadcrumb', () => {
    const out = html(
      h(PageHeader, {
        title: 'Invoices',
        breadcrumb: [{ label: 'Sale' }, { label: 'Invoices' }],
        actions: h('button', null, '+ Add Sale'),
      }),
    );
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('+ Add Sale');
    expect(html(h(PageHeader, { title: 'Old' }))).not.toContain('Breadcrumb');
  });
});

describe('shell pieces', () => {
  it('a menu group says whether it is open, and the current page is marked', () => {
    const entry = {
      id: 'sale',
      label: 'Sale',
      children: [{ id: 'inv', label: 'Invoices', path: '/sales/invoices' }],
    };
    const open = html(
      h(NavItem, { entry, activeId: 'inv', open: true, onToggle: () => {}, onGo: () => {} }),
    );
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-current="page"');
    expect(
      html(h(NavItem, { entry, activeId: 'x', open: false, onToggle: () => {}, onGo: () => {} })),
    ).not.toContain('Invoices');
  });

  it('asks for a business name, and shows the set-up dot until the profile is complete', () => {
    expect(html(h(BusinessNameField, { profile: {}, onSave: () => {} }))).toContain(
      'placeholder="Enter Business Name"',
    );
    expect(profileIncomplete({ businessName: 'A', state: 'Kerala', address: 'x' })).toBe(false);
    expect(profileIncomplete({ businessName: 'A' })).toBe(true);
    expect(
      html(h(BusinessNameField, { profile: { businessName: 'A', state: 'Kerala', address: 'x' } })),
    ).not.toContain('vy-biz-dot');
  });
});
