// The small rich-text box used for terms, notes and extra sections.
import { useEffect, useRef, useCallback } from 'react';
import { promptAction } from '../../../components/ui/ConfirmModal';
import DOMPurify from 'dompurify';

// Rich text editor component that works with contentEditable properly
export default function RichEditor({ value, onChange, placeholder, toolbar = false }) {
  const ref = useRef(null);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (ref.current && !isInitialized.current) {
      ref.current.innerHTML = DOMPurify.sanitize(value || '');
      isInitialized.current = true;
    }
  }, []);

  // Update if value changes externally (e.g. draft restore, editing bill)
  useEffect(() => {
    if (ref.current && isInitialized.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = DOMPurify.sanitize(value || '');
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (ref.current) {
      onChange(ref.current.innerHTML);
    }
  }, [onChange]);

  // Toolbar formatting via document.execCommand. The existing innerHTML setters above
  // already wrap user content with DOMPurify.sanitize(), and the toolbar only emits
  // standard formatting tags that the same sanitizer keeps.
  const applyFormat = (cmd, val) => {
    if (ref.current) ref.current.focus();
    document.execCommand(cmd, false, val);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const btnStyle = { padding: '0.2rem 0.5rem', fontSize: '0.78rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', minWidth: '28px' };

  return (
    <>
      {toolbar && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
          <button type="button" onClick={() => applyFormat('bold')}        title="Bold (Ctrl+B)"      style={{ ...btnStyle, fontWeight: 700 }}>B</button>
          <button type="button" onClick={() => applyFormat('italic')}      title="Italic (Ctrl+I)"    style={{ ...btnStyle, fontStyle: 'italic' }}>I</button>
          <button type="button" onClick={() => applyFormat('underline')}   title="Underline (Ctrl+U)" style={{ ...btnStyle, textDecoration: 'underline' }}>U</button>
          <span style={{ width: 1, background: 'var(--border-color)', margin: '0 0.2rem' }} />
          <button type="button" onClick={() => applyFormat('insertUnorderedList')} title="Bullet list"  style={btnStyle}>•&nbsp;List</button>
          <button type="button" onClick={() => applyFormat('insertOrderedList')}   title="Numbered list" style={btnStyle}>1.&nbsp;List</button>
          <span style={{ width: 1, background: 'var(--border-color)', margin: '0 0.2rem' }} />
          <button type="button" onClick={() => applyFormat('formatBlock', '<h4>')}  title="Heading"   style={{ ...btnStyle, fontWeight: 700, fontSize: '0.85rem' }}>H</button>
          <button type="button" onClick={() => applyFormat('formatBlock', '<p>')}   title="Paragraph" style={btnStyle}>¶</button>
          <button type="button" onClick={async () => {
            const url = await promptAction({
              title: 'Insert link',
              message: 'Paste the URL to link to. Selected text will become the link.',
              placeholder: 'https://example.com',
              confirmLabel: 'Insert',
            });
            if (url) applyFormat('createLink', url);
          }} title="Insert link" style={btnStyle}>🔗</button>
          <span style={{ width: 1, background: 'var(--border-color)', margin: '0 0.2rem' }} />
          <button type="button" onClick={() => applyFormat('removeFormat')} title="Clear formatting" style={btnStyle}>✕</button>
        </div>
      )}
      <div ref={ref} contentEditable suppressContentEditableWarning
        className="form-input rich-editor"
        onInput={handleInput}
        style={{ minHeight: '100px', whiteSpace: 'pre-wrap' }}
        data-placeholder={placeholder} />
    </>
  );
}
