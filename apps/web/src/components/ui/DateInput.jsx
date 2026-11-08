import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { isoToDisplay, parseTypedDate, withinBounds } from './lib/format';

// A date box (P0-S3.3): type dd-MM-yyyy (or just 060126) or pick from the calendar. The value on the wire is ISO
// (yyyy-MM-dd); min and max (the FY lock) apply to both typing and picking.

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function Calendar({ value, min, max, onPick }) {
  const start = value || todayIso();
  const [view, setView] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const move = (delta) => setView((v) => {
    const d = new Date(v.y, v.m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const today = todayIso();
  return (
    <div className="ui-pop ui-cal" role="dialog" aria-label="Choose a date">
      <div className="ui-cal-head">
        <button type="button" className="ui-icon-btn" onClick={() => move(-1)} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <span aria-live="polite">
          {MONTHS[view.m]} {view.y}
        </span>
        <button type="button" className="ui-icon-btn" onClick={() => move(1)} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="ui-cal-grid">
        {DOW.map((d) => (
          <span key={d} className="ui-cal-dow">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${view.y}-${pad(view.m + 1)}-${pad(i + 1)}`;
          return (
            <button
              key={iso}
              type="button"
              className="ui-cal-day"
              aria-pressed={iso === value}
              aria-label={isoToDisplay(iso)}
              data-today={iso === today}
              disabled={!withinBounds(iso, min, max)}
              onClick={() => onPick(iso)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateInput({ value, onChange, min, max, onBlur, className = '', ...rest }) {
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const commit = (text) => {
    if (!String(text || '').trim()) {
      setBad(false);
      onChange?.('');
      return;
    }
    const iso = parseTypedDate(text);
    const ok = iso && withinBounds(iso, min, max);
    setBad(!ok);
    if (ok) onChange?.(iso);
  };

  return (
    <span className="ui-affix" ref={wrap} style={{ position: 'relative' }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd-mm-yyyy"
        className={`ui-input has-suffix ${className}`.trim()}
        style={{ paddingLeft: 'var(--s-3)', paddingRight: 40 }}
        value={draft ?? isoToDisplay(value)}
        aria-invalid={bad || rest['aria-invalid'] || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (draft !== null) commit(draft);
          setDraft(null);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft !== null) commit(draft);
          if (e.key === 'ArrowDown' && e.altKey) setOpen(true);
        }}
        {...rest}
      />
      <span className="ui-suffix">
        <button type="button" className="ui-icon-btn" aria-label="Open calendar" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <CalendarDays size={16} />
        </button>
      </span>
      {open && (
        <Calendar
          value={value}
          min={min}
          max={max}
          onPick={(iso) => {
            setBad(false);
            onChange?.(iso);
            setOpen(false);
          }}
        />
      )}
    </span>
  );
}
