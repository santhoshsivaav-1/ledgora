import { formatMoney } from './lib/format';

// Small display pieces (P0-S3.5). Status colours follow the blueprint: Paid green, Partial amber, Unpaid red,
// Cancelled grey, Overdue red outline.

export function StatusChip({ tone = 'neutral', outline = false, children }) {
  return (
    <span className="ui-status" data-tone={tone} data-outline={outline || undefined}>
      {children}
    </span>
  );
}

const PAYMENT_TONES = {
  paid: ['success', 'Paid'],
  partial: ['warn', 'Partial'],
  unpaid: ['danger', 'Unpaid'],
  cancelled: ['neutral', 'Cancelled'],
  overdue: ['danger', 'Overdue'],
  draft: ['neutral', 'Draft'],
};

/** The chip for an invoice's payment status, so every list colours it the same way. */
export function PaymentStatusChip({ status }) {
  const [tone, label] = PAYMENT_TONES[status] || ['neutral', status || '—'];
  return (
    <StatusChip tone={tone} outline={status === 'overdue'}>
      {label}
    </StatusChip>
  );
}

export function Badge({ tone, children, label }) {
  return (
    <span className="ui-badge" data-tone={tone} aria-label={label}>
      {children}
    </span>
  );
}

export function Kbd({ children }) {
  return <kbd className="ui-kbd">{children}</kbd>;
}

export function Skeleton({ width = '100%', height = 12, style }) {
  return <span className="ui-skel" aria-hidden="true" style={{ width, height, ...style }} />;
}

/** Up to two initials on a navy circle. */
export function Avatar({ name = '', size = 32 }) {
  const initials =
    String(name)
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?';
  return (
    <span className="ui-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** An amount in rupees with Indian grouping. `signed` colours it: green above zero, red below. */
export function Money({ value, signed = false, currency = true }) {
  const n = Number(value) || 0;
  const cls = signed ? (n > 0 ? 'ui-pos' : n < 0 ? 'ui-neg' : '') : '';
  const text = `${n < 0 ? '−' : ''}${currency ? '₹' : ''}${formatMoney(Math.abs(n))}`;
  return <span className={`ui-money ${cls}`.trim()}>{text}</span>;
}

export function PromoCard({ icon, title, text, action }) {
  return (
    <div className="ui-promo">
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ui-promo-title">{title}</div>
        {text && <div className="ui-promo-text">{text}</div>}
      </div>
      {action}
    </div>
  );
}

/** A large selectable card with a round illustration (Import method, Party type), radio top-right. */
export function OptionCard({ name, value, checked, onChange, icon, title, text, badge }) {
  return (
    <label className="ui-option-card" data-checked={checked}>
      {badge && <span className="ui-option-card-badge">{badge}</span>}
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange?.(value)} />
      <span className="ui-option-card-art" aria-hidden="true">
        {icon}
      </span>
      <span className="ui-option-card-title">{title}</span>
      {text && <span className="ui-option-card-text">{text}</span>}
    </label>
  );
}
