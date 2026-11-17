// v1.10.37 — Reusable page-header card. Reported: "I like the heading
// that you gave into this page — I want you to do in all the pages,
// that looks better". Extracted from the SettingsView v1.10.36 header
// so every page gets a consistent visual identity: gradient card +
// icon badge + title + subtitle + optional meta chip + right-side
// action slot.
//
// One look for every page (audit U6): the same height, the same 16px gap below, actions always on the right and wrapping as a unit.
// The styles are in pageHeader.css, so no screen can drift from them.
//
// Props:
//   icon        emoji / string / element rendered inside the 44px badge
//   title       page title (h1)
//   subtitle    one-line description shown below the title
//   meta        optional short string rendered as a pill next to the
//               subtitle (e.g. "231 invoices", "11 sections", "FY 2025-26")
//   children    right-hand slot for action buttons, HelpButton, etc.
//   compact     v1.10.77 (#84): a slim title row, no card, icon or subtitle,
//               for screens where the table needs the room (the Dashboard).
//   breadcrumb  Vyapar parity P0-S2: [{ label, to? }] shown small above the title ("Sale › Invoices").
//   actions     the page's primary action (top right); the same slot as children, named for new screens.

import './pageHeader.css';

function Breadcrumb({ items }) {
  if (!items?.length) return null;
  return (
    <nav className="ui-crumbs" aria-label="Breadcrumb">
      {items.map((b, i) => (
        <span key={b.label} className="ui-crumb">
          {i > 0 && <span aria-hidden="true">›</span>}
          {b.to ? <a href={b.to}>{b.label}</a> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{b.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export default function PageHeader({ icon, title, subtitle, meta, children, actions, breadcrumb, compact = false }) {
  const slot = actions ? <>{children}{actions}</> : children;
  if (compact) {
    return (
      <div className="page-header ph ph-compact">
        {breadcrumb && <div className="ph-crumbs"><Breadcrumb items={breadcrumb} /></div>}
        <h1 className="page-title ph-title">{title}</h1>
        {meta && <span className="ph-meta-plain">{meta}</span>}
        {slot && <div className="ph-actions">{slot}</div>}
      </div>
    );
  }
  return (
    <div className="page-header ph">
      {icon !== undefined && <div className="ph-icon" aria-hidden="true">{icon}</div>}
      <div className="ph-text">
        <Breadcrumb items={breadcrumb} />
        <h1 className="page-title ph-title">{title}</h1>
        {(subtitle || meta) && (
          <p className="page-subtitle ph-sub">
            {subtitle && <span>{subtitle}</span>}
            {meta && <span className="ph-meta">{meta}</span>}
          </p>
        )}
      </div>
      {slot && <div className="ph-actions">{slot}</div>}
    </div>
  );
}
