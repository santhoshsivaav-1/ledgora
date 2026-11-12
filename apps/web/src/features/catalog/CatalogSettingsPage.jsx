import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Store } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { apiClient } from '../../lib/apiClient';
import { listBusinesses } from '../../lib/data/accounting';
import { useEntitlements } from '../billing/useEntitlements';

// Grow > Online catalog (P9-S6): a public page of the items you choose, with a WhatsApp enquiry button. Mark items with
// "Show in online catalog" on the Products screen.
export default function CatalogSettingsPage() {
  const { can, hasFeature } = useEntitlements();
  const [biz, setBiz] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listBusinesses(), apiClient.get('/v1/catalog')])
      .then(([list, res]) => {
        const b = list.find((x) => x.isDefault) || list[0];
        setBiz(b);
        const c = res.catalog;
        const fallback = (b?.name || 'my-shop').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-shop';
        setF({ enabled: !!c?.enabled, slug: c?.slug || fallback, title: c?.title || b?.name || '', whatsapp: c?.whatsapp || '', showPrice: c?.showPrice ?? true, showStock: c?.showStock ?? true });
      })
      .catch(setError);
  }, []);

  if (error) return <ErrorState message={error.message} />;
  if (!f) return <LoadingState label="Opening your catalog…" />;
  const url = `${window.location.origin}/c/${f.slug}`;
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await apiClient.put('/v1/catalog', { businessId: biz.id, ...f, whatsapp: f.whatsapp.replace(/\s/g, '') });
      toast(f.enabled ? 'Your catalog is live' : 'Saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const editable = can('settings:write');

  return (
    <div>
      <PageHeader icon={<Store size={22} />} title="Online catalog" subtitle="A page anyone can open to see what you sell and ask on WhatsApp" />
      {!hasFeature('catalog_offers') && <div className="notice notice-info" role="status" style={{ marginBottom: 12 }}>The online catalog is part of the Silver and Gold plans.</div>}
      <div className="glass-panel p-6 mb-6" style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={f.enabled} onChange={set('enabled')} disabled={!editable} /> <strong>Catalog is live</strong>
        </label>
        <div className="form-group"><label className="form-label" htmlFor="cat-slug">Address</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="ui-help">{window.location.origin}/c/</span>
            <input id="cat-slug" className="form-input" value={f.slug} maxLength={40} onChange={set('slug')} disabled={!editable} /></div></div>
        <div className="form-group"><label className="form-label" htmlFor="cat-title">Title</label><input id="cat-title" className="form-input" value={f.title} maxLength={80} onChange={set('title')} disabled={!editable} /></div>
        <div className="form-group"><label className="form-label" htmlFor="cat-wa">WhatsApp number for enquiries</label><input id="cat-wa" className="form-input" value={f.whatsapp} placeholder="+919876543210" onChange={set('whatsapp')} disabled={!editable} /></div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.showPrice} onChange={set('showPrice')} disabled={!editable} /> Show prices</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.showStock} onChange={set('showStock')} disabled={!editable} /> Show "in stock" / "out of stock"</label>
        <p className="ui-help" style={{ margin: 0 }}>Choose the items on the Products screen with "Show in online catalog". Costs, stock counts and customers are never shown.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editable && <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
          <button type="button" className="btn btn-secondary" onClick={() => { navigator.clipboard?.writeText(url); toast('Link copied', 'success'); }}><Copy size={14} /> Copy link</button>
          <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
          <a className="btn btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(`See what we sell: ${url}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        </div>
      </div>
    </div>
  );
}
