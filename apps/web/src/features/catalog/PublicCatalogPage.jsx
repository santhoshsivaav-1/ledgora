import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import './catalog.css';

// The public catalogue at /c/<slug>: no sign-in. Items, optional price and stock, and an enquiry button per item that opens
// WhatsApp with the item's name.
export default function PublicCatalogPage({ slug }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    fetch(`/v1/public/catalog/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { setData(d); document.title = d.title || 'Catalog'; })
      .catch(() => setMissing(true));
  }, [slug]);
  if (missing) return <main className="pc-shell"><h1>This catalog is not available</h1><p className="pc-muted">Check the link with the shop.</p></main>;
  if (!data) return <main className="pc-shell"><p className="pc-muted">Loading…</p></main>;
  const wa = (item) => `https://wa.me/${data.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello, I am interested in ${item.name}.`)}`;
  const shown = data.items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <main className="pc-shell">
      <header className="pc-head">
        <h1>{data.title || 'Our products'}</h1>
        <input className="pc-search" type="search" placeholder="Search" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      {shown.length === 0 && <p className="pc-muted">Nothing to show yet.</p>}
      <ul className="pc-grid">
        {shown.map((i) => (
          <li key={i.id} className="pc-card">
            {i.image ? <img src={i.image} alt="" className="pc-img" /> : <div className="pc-img pc-noimg" aria-hidden="true">{i.name.slice(0, 1)}</div>}
            <h2>{i.name}</h2>
            {i.description && <p className="pc-muted">{i.description}</p>}
            {'price' in i && <p className="pc-price">₹{Number(i.price).toLocaleString('en-IN')}{i.unit ? <small> / {i.unit}</small> : null}{i.mrp && i.mrp > i.price ? <s className="pc-muted"> ₹{i.mrp}</s> : null}</p>}
            {'inStock' in i && <p className={i.inStock ? 'pc-in' : 'pc-out'}>{i.inStock ? 'In stock' : 'Out of stock'}</p>}
            {data.whatsapp && <a className="pc-ask" href={wa(i)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Ask on WhatsApp</a>}
          </li>
        ))}
      </ul>
    </main>
  );
}
