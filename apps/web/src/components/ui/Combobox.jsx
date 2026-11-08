import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

// A searchable picker (P0-S3.3) for parties and items: type to search, arrows to move, Enter to choose, Esc to close,
// and a `+ Add new "<what you typed>"` row when `onCreate` is given. `search` may be async (a server query); the
// newest answer wins, so a slow early reply never replaces a later one.

export default function Combobox({
  value,
  onChange,
  search,
  getLabel = (o) => o?.label ?? '',
  getKey = (o) => o?.id ?? getLabel(o),
  renderOption,
  onCreate,
  placeholder = 'Search…',
  emptyText = 'No matches',
  className = '',
  ...rest
}) {
  const listId = useId();
  const [query, setQuery] = useState(null); // null: show the chosen value's label
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const ticket = ++seq.current;
    let live = true;
    setLoading(true);
    Promise.resolve(search(query ?? ''))
      .then((list) => {
        if (live && ticket === seq.current) {
          setOptions(Array.isArray(list) ? list : []);
          setActive(0);
        }
      })
      .catch(() => live && setOptions([]))
      .finally(() => live && ticket === seq.current && setLoading(false));
    return () => {
      live = false;
    };
  }, [query, open, search]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) {
        setOpen(false);
        setQuery(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const typed = (query ?? '').trim();
  const showCreate = !!onCreate && typed !== '' && !options.some((o) => getLabel(o).toLowerCase() === typed.toLowerCase());
  const count = options.length + (showCreate ? 1 : 0);

  const choose = (i) => {
    if (i < options.length) onChange?.(options[i]);
    else if (showCreate) onCreate(typed);
    setOpen(false);
    setQuery(null);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && count > 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setQuery(null);
    }
  };

  return (
    <div className="ui-affix" ref={wrap} style={{ position: 'relative' }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && count > 0 ? `${listId}-${active}` : undefined}
        className={`ui-input ${className}`.trim()}
        style={{ paddingLeft: 'var(--s-3)' }}
        placeholder={placeholder}
        value={query ?? (value ? getLabel(value) : '')}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        {...rest}
      />
      {open && (
        <div className="ui-pop">
          <ul className="ui-listbox" role="listbox" id={listId}>
            {options.map((o, i) => (
              <li
                key={getKey(o)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="ui-option"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {renderOption ? renderOption(o) : getLabel(o)}
              </li>
            ))}
            {options.length === 0 && !showCreate && (
              <li className="ui-option ui-option-muted" aria-disabled="true">
                {loading ? 'Searching…' : emptyText}
              </li>
            )}
            {showCreate && (
              <li
                id={`${listId}-${options.length}`}
                role="option"
                aria-selected={active === options.length}
                className="ui-option ui-option-create"
                onMouseEnter={() => setActive(options.length)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(options.length)}
              >
                <Plus size={14} aria-hidden="true" /> Add new “{typed}”
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
