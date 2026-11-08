import { X } from 'lucide-react';

// The extra keys of the new shell (Vyapar parity P0-S2), listed only while it is on.
const VYAPAR_KEYS = [
  [['Ctrl', 'F'], 'Open Anything (search screens, parties, items, invoices)'],
  [['Ctrl', 'Shift', 'S'], 'Save and start a new one (on forms that have it)'],
  [['Alt', 'N'], 'New: the document of the page you are on'],
  [['Alt', 'B'], 'Shrink or open the menu'],
  [['?'], 'This help'],
];

// Ctrl/Cmd+/ : the keyboard reference (change 3.5).
export default function ShortcutsHelp({ open, onClose, vyapar = false }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={() => onClose()}>
      <div
        className="modal-content"
        style={{ maxWidth: '480px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h3 className="section-title" style={{ margin: 0 }}>
            Keyboard Shortcuts
          </h3>
          <button className="icon-btn" onClick={() => onClose()} title="Close">
            <X size={18} />
          </button>
        </div>
        <table className="kv-list">
          <tbody>
            <tr>
              <td>
                <kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>K</kbd>
              </td>
              <td>Open command palette (jump to any page)</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>N</kbd>
              </td>
              <td>New invoice</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>S</kbd>
              </td>
              <td>Save current invoice (when on the invoice form)</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>P</kbd>
              </td>
              <td>Download PDF (when on the invoice form)</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>&nbsp;+&nbsp;<kbd>/</kbd>
              </td>
              <td>Toggle this help</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Close any open modal</td>
            </tr>
            {vyapar &&
              VYAPAR_KEYS.map(([keys, what]) => (
                <tr key={what}>
                  <td>
                    {keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <>&nbsp;+&nbsp;</>}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            marginTop: '0.75rem',
            marginBottom: 0,
          }}
        >
          On macOS, use <kbd>⌘</kbd> instead of <kbd>Ctrl</kbd>.
        </p>
      </div>
    </div>
  );
}
