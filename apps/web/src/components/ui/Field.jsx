import { cloneElement, isValidElement, useId, useState } from 'react';
import { formatMoney, formatQty, parseAmount, roundTo } from './lib/format';

// Form primitives (Vyapar parity P0-S3.3). Label above, a red * when required, help text, and the error under the
// field. Field wires the label to its input through `id`, so screen readers read the label, the help and the error.

export function Field({ label, required = false, help, error, id, children, className = '' }) {
  const autoId = useId();
  const fieldId = id || autoId;
  const helpId = help ? `${fieldId}-help` : undefined;
  const errorId = error ? `${fieldId}-err` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || fieldId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [errorId, helpId].filter(Boolean).join(' ') || undefined,
        'aria-required': required || undefined,
      })
    : children;
  return (
    <div className={`ui-field ${className}`.trim()}>
      {label && (
        <label className="ui-label" htmlFor={fieldId}>
          {label}
          {required && (
            <span className="ui-req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {control}
      {error ? (
        <span className="ui-error" id={errorId} role="alert">
          {error}
        </span>
      ) : (
        help && (
          <span className="ui-help" id={helpId}>
            {help}
          </span>
        )
      )}
    </div>
  );
}

/** A text box that trims spaces when it loses focus. */
export function TextInput({ value, onChange, onBlur, trim = true, className = '', ...rest }) {
  return (
    <input
      type="text"
      className={`ui-input ${className}`.trim()}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={(e) => {
        if (trim && e.target.value !== e.target.value.trim()) onChange?.(e.target.value.trim());
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}

/**
 * A number box that shows Indian grouping when not being edited and accepts "1,23,456.50" or "123456.5" while it is.
 * `onChange` receives a number, or null when empty. Rounded to `places` on blur.
 */
function NumberBox({ value, onChange, onBlur, places, allowNegative, format, prefix, className = '', ...rest }) {
  const [draft, setDraft] = useState(null); // text while focused; null shows the formatted value
  const shown = draft ?? format(value);
  return (
    <span className="ui-affix">
      {prefix && (
        <span className="ui-prefix" aria-hidden="true">
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        className={`ui-input ui-input-num ${className}`.trim()}
        style={prefix ? undefined : { paddingLeft: 'var(--s-3)' }}
        value={shown}
        onFocus={() => setDraft(value === null || value === undefined || value === '' ? '' : String(value))}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseAmount(e.target.value, { allowNegative });
          if (n === null || Number.isFinite(n)) onChange?.(n);
        }}
        onBlur={(e) => {
          const n = parseAmount(draft, { allowNegative });
          if (Number.isFinite(n)) onChange?.(roundTo(n, places));
          setDraft(null);
          onBlur?.(e);
        }}
        {...rest}
      />
    </span>
  );
}

export function MoneyInput({ allowNegative = false, ...rest }) {
  return <NumberBox places={2} allowNegative={allowNegative} format={formatMoney} prefix="₹" {...rest} />;
}

/** Quantity: up to 3 decimals by default (the item setting can make it 0 to 4). */
export function QtyInput({ places = 3, ...rest }) {
  return <NumberBox places={places} allowNegative={false} format={(n) => formatQty(n, places)} {...rest} />;
}

/** Native select, styled; for up to about a dozen options. `options` is [{ value, label }] or plain strings. */
export function Select({ value, onChange, options = [], placeholder, className = '', ...rest }) {
  return (
    <select className={`ui-select ${className}`.trim()} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, ...rest }) {
  return (
    <label className="ui-check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} {...rest} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, ...rest }) {
  return (
    <label className="ui-switch">
      <input type="checkbox" role="switch" checked={!!checked} aria-checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} {...rest} />
      <span className="ui-switch-track" aria-hidden="true" />
      {label}
    </label>
  );
}

/** Choices as cards with a title and a line of help (Party type, Import method). */
export function RadioCards({ name, value, onChange, options = [], ariaLabel }) {
  const autoName = useId();
  return (
    <div className="ui-radio-cards" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <label key={o.value} className="ui-radio-card" data-checked={value === o.value}>
          <input type="radio" name={name || autoName} value={o.value} checked={value === o.value} onChange={() => onChange?.(o.value)} disabled={o.disabled} />
          <span className="ui-radio-card-title">{o.label}</span>
          {o.description && <span className="ui-radio-card-text">{o.description}</span>}
        </label>
      ))}
    </div>
  );
}
