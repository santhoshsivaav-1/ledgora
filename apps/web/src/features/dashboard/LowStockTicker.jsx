// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).

import { useRef, useState, useEffect } from 'react';
import { Package } from 'lucide-react';

// v1.10.77 (#84) - low stock as one line under a "Low stock" heading, like a
// news ticker. v1.10.78 - it only moves when the list is wider than its strip
// (then a second copy makes the loop seamless); a short list stays still, so
// two products no longer show up as four. Pauses while pointed at; with
// reduced motion it is a plain row that scrolls sideways. Each name opens
// Products (#44).
export default function LowStockTicker({ products, onOpenProducts }) {
  const windowRef = useRef(null);
  const trackRef = useRef(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const win = windowRef.current;
    const track = trackRef.current;
    if (!win || !track || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const oneCopy = track.scrollWidth / (track.dataset.copies === '2' ? 2 : 1);
      setScrolls(oneCopy > win.clientWidth + 1);
    });
    ro.observe(win);
    ro.observe(track);
    return () => ro.disconnect();
  }, [products.length]);
  const copies = scrolls ? [0, 1] : [0];
  return (
    <div className="glass-panel low-stock-ticker" style={{ marginBottom: '1rem', padding: '0.55rem 1rem' }}>
      <span className="low-stock-ticker-label">
        <Package size={16} /> Low stock ({products.length})
      </span>
      <div ref={windowRef} className={`low-stock-ticker-window${scrolls ? ' is-scrolling' : ''}`}>
        <div ref={trackRef} data-copies={copies.length} className="low-stock-ticker-track"
          style={scrolls ? { animationDuration: `${Math.max(12, products.length * 4)}s` } : undefined}>
          {copies.map((copy) => products.map((p) => (
            <button
              key={`${copy}-${p.id}`}
              type="button"
              onClick={onOpenProducts}
              aria-hidden={copy === 1 ? 'true' : undefined}
              tabIndex={copy === 1 ? -1 : undefined}
              title={onOpenProducts ? `Open Products to restock ${p.name}` : undefined}
              className={`low-stock-chip${(p.stock ?? 0) <= 0 ? ' low-stock-out' : ''}`}>
              <strong>{p.name}</strong>
              {p.hsn ? <span className="text-muted" style={{ marginLeft: 4, fontSize: '0.72rem' }}>({p.hsn})</span> : null}
              <span style={{ marginLeft: 6, fontWeight: 700 }}>
                {(p.stock ?? 0) <= 0 ? 'Out of Stock' : `Stock: ${p.stock}`}
              </span>
            </button>
          )))}
        </div>
      </div>
    </div>
  );
}
