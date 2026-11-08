import { fyLabel, fyOptions, setSelectedFy, useSelectedFy } from './fiscalYear';

// The financial-year picker in the new top bar (P0-S2). It sets the year that "This FY" and the period filters of
// the new screens start on; the classic screens keep their own year selectors.

export default function FYSwitcher({ fyStartMonth = 4 }) {
  const selected = useSelectedFy();
  const options = fyOptions(new Date(), fyStartMonth);
  if (!options.some((o) => o.start === selected)) options.push({ start: selected, label: fyLabel(selected, fyStartMonth) });
  return (
    <select className="ui-select vy-fy" aria-label="Financial year" title="Financial year" value={selected} onChange={(e) => setSelectedFy(Number(e.target.value))}>
      {options.map((o) => (
        <option key={o.start} value={o.start}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
