import { useId } from 'react';
import { useSearchParams } from 'react-router';
import { Check } from 'lucide-react';

// Tabs and Stepper (P0-S3.4). Tabs are underline style with arrow-key movement; with `urlParam` the open tab lives in
// the address (?tab=ledger), so a reload or a shared link opens the same tab.

export function TabStrip({ tabs, value, onChange, ariaLabel }) {
  const base = useId();
  const move = (e, i) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    onChange(next.id);
    document.getElementById(`${base}-${next.id}`)?.focus();
  };
  return (
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          id={`${base}-${t.id}`}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => move(e, i)}
        >
          {t.label}
          {t.count !== undefined && t.count !== null && <span className="ui-help"> ({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

/** Tabs whose choice is kept in the URL. Use inside the router only. */
export function UrlTabs({ tabs, urlParam = 'tab', ariaLabel, children }) {
  const [params, setParams] = useSearchParams();
  const current = tabs.some((t) => t.id === params.get(urlParam)) ? params.get(urlParam) : tabs[0]?.id;
  return (
    <>
      <TabStrip
        tabs={tabs}
        value={current}
        ariaLabel={ariaLabel}
        onChange={(id) => {
          const next = new URLSearchParams(params);
          next.set(urlParam, id);
          setParams(next, { replace: true });
        }}
      />
      <div role="tabpanel">{children(current)}</div>
    </>
  );
}

/** Numbered steps: done ones get a tick, the current one is highlighted. `current` is an index. */
export function Stepper({ steps, current = 0 }) {
  return (
    <ol className="ui-stepper">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        return [
          i > 0 && <li key={`line${i}`} className="ui-step-line" aria-hidden="true" />,
          <li key={label} className="ui-step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="ui-step-num">{state === 'done' ? <Check size={14} aria-label="done" /> : i + 1}</span>
            {label}
          </li>,
        ];
      })}
    </ol>
  );
}
