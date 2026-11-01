import { useEffect, useId, useRef, useState } from 'react';

// Small hand-drawn SVG charts for the analytics dashboard. The app ships no chart library and
// these four shapes are all the page needs.

import { compactMoney, fullMoney } from './money';

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// A round axis maximum: 1, 2, 2.5, 5 or 10 times a power of ten.
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// A smooth line through the points (monotone-ish: horizontal tangents at every point, so it never overshoots).
const smooth = (pts) => pts.reduce((d, [x, y], i) => {
  if (i === 0) return `M${x},${y}`;
  const [px, py] = pts[i - 1];
  const mx = (px + x) / 2;
  return `${d} C${mx},${py} ${mx},${y} ${x},${y}`;
}, '');

export function RevenueChart({ series, currency, compared, height = 280 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const id = useId();
  const pad = { t: 12, r: 8, b: 26, l: 52 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...series.map((p) => Math.max(p.value, compared ? p.prev : 0))));
  const x = (i) => pad.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const y = (v) => pad.t + ih - (Math.max(0, v) / max) * ih;
  const cur = series.map((p, i) => [x(i), y(p.value)]);
  const prev = series.map((p, i) => [x(i), y(p.prev)]);
  const line = smooth(cur);
  const area = `${line} L${x(series.length - 1)},${pad.t + ih} L${x(0)},${pad.t + ih} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(iw / 78))));
  const h = hover == null ? null : series[hover];

  const move = (clientX) => {
    const box = ref.current.getBoundingClientRect();
    const i = Math.round(((clientX - box.left - pad.l) / iw) * (series.length - 1));
    setHover(Math.min(series.length - 1, Math.max(0, i)));
  };
  const key = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setHover((i) => Math.min(series.length - 1, (i ?? -1) + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setHover((i) => Math.max(0, (i ?? series.length) - 1)); }
    if (e.key === 'Escape') setHover(null);
  };

  return (
    <div ref={ref} className="ad-chart" style={{ height }}>
      <svg
        width={width} height={height} role="img" tabIndex={0}
        aria-label={`Revenue over time. Use the left and right arrow keys to read each point.`}
        onMouseMove={(e) => move(e.clientX)} onMouseLeave={() => setHover(null)}
        onFocus={() => setHover((i) => i ?? series.length - 1)} onBlur={() => setHover(null)} onKeyDown={key}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ad-accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--ad-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="ad-grid" />
            <text x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end" className="ad-axis">{t === 0 ? '0' : compactMoney(t, currency)}</text>
          </g>
        ))}
        {series.map((p, i) => (i % labelEvery === 0 ? (
          <text key={p.date} x={x(i)} y={height - 6} textAnchor="middle" className="ad-axis">{shortDate(p.date)}</text>
        ) : null))}
        {compared && <path d={smooth(prev)} className="ad-line-prev" />}
        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={line} className="ad-line" />
        {h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="ad-cross" />
            {compared && <circle cx={x(hover)} cy={y(h.prev)} r="3.5" className="ad-dot-prev" />}
            <circle cx={x(hover)} cy={y(h.value)} r="4.5" className="ad-dot" />
          </g>
        )}
      </svg>
      {h && (
        <div className="ad-tip" style={{ left: Math.min(width - 190, Math.max(0, x(hover) - 95)), top: 0 }} role="status">
          <div className="ad-tip-date">{h.date === h.endDate ? shortDate(h.date) : `${shortDate(h.date)} – ${shortDate(h.endDate)}`}</div>
          <div className="ad-tip-row"><i className="ad-key ad-key-cur" />Revenue<b>{fullMoney(h.value, currency)}</b></div>
          {compared && <div className="ad-tip-row"><i className="ad-key ad-key-prev" />Previous<b>{fullMoney(h.prev, currency)}</b></div>}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 96, height = 30 }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [values.length === 1 ? width / 2 : (i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)]);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true" className="ad-spark">
      <path d={smooth(pts)} />
      {last && <circle cx={last[0]} cy={last[1]} r="2.5" />}
    </svg>
  );
}
