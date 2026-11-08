// Settings building blocks (Template E, used by Phase 8): a white card per section, and a row per setting with the
// label and help on the left and the control on the right.

export function SettingsSection({ title, children }) {
  return (
    <section className="ui-card ui-card-pad ui-setting-section">
      {title && <h2 className="ui-section-title">{title}</h2>}
      {children}
    </section>
  );
}

export function SettingRow({ label, help, htmlFor, children }) {
  return (
    <div className="ui-setting-row">
      <div className="ui-setting-text">
        {htmlFor ? (
          <label className="ui-setting-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="ui-setting-label">{label}</div>
        )}
        {help && <div className="ui-setting-help">{help}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
