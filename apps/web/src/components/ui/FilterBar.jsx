import { useState } from 'react';
import { Search } from 'lucide-react';
import DateInput from './DateInput';
import { formatMoney } from './lib/format';
import { PERIOD_PRESETS, periodRange } from './lib/period';
import { useSelectedFy } from '../../app/fiscalYear';

// The strip over every list and report (P0-S3.2): period, a few selects, search, and Export on the right; the
// summary chips (To Collect / To Pay / Total) sit under it.

export function FilterBar({ children, right }) {
  return (
    <div className="ui-filterbar" role="search">
      {children}
      {right && <div className="ui-filterbar-right">{right}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search' }) {
  return (
    <span className="ui-search">
      <Search size={15} aria-hidden="true" />
      <input type="search" className="ui-input" aria-label={label} placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} />
    </span>
  );
}

/**
 * Period presets (Today ... Last FY, Custom). `value` and `onChange` use { id, label, from, to } with ISO dates.
 * FY boundaries follow `fyStartMonth` (April unless the business says otherwise); This FY is the year chosen in the
 * top bar's FY switcher.
 */
export function PeriodPicker({ value, onChange, fyStartMonth = 4, today, presets = PERIOD_PRESETS.map(([id]) => id), label = 'Period' }) {
  const current = value?.id || 'this-month';
  const fyStart = useSelectedFy();
  const [custom, setCustom] = useState({ from: value?.from || '', to: value?.to || '' });
  const pick = (id) => onChange?.(periodRange(id, { today, fyStartMonth, fyStart, ...custom }));
  return (
    <span className="ui-period">
      <select className="ui-select" aria-label={label} value={current} onChange={(e) => pick(e.target.value)}>
        {PERIOD_PRESETS.filter(([id]) => presets.includes(id)).map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      {current === 'custom' && (
        <>
          <DateInput
            aria-label="From"
            value={custom.from}
            max={custom.to || undefined}
            onChange={(from) => {
              setCustom((c) => ({ ...c, from }));
              onChange?.(periodRange('custom', { from, to: custom.to }));
            }}
          />
          <DateInput
            aria-label="To"
            value={custom.to}
            min={custom.from || undefined}
            onChange={(to) => {
              setCustom((c) => ({ ...c, to }));
              onChange?.(periodRange('custom', { from: custom.from, to }));
            }}
          />
        </>
      )}
    </span>
  );
}

/** [{ label, value, tone?: 'pos'|'neg'|'warn', hint?, money? }]. Numbers are shown as rupees unless money is false. */
export function SummaryChips({ chips = [] }) {
  return (
    <div className="ui-chips">
      {chips.map((c) => (
        <div key={c.label} className="ui-chip" data-tone={c.tone} title={c.hint}>
          <span className="ui-chip-label">{c.label}</span>
          <span className="ui-chip-value">{typeof c.value === 'number' && c.money !== false ? `₹${formatMoney(c.value)}` : c.value}</span>
        </div>
      ))}
    </div>
  );
}
