import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import RichEditor from './RichEditor';

// Extra pages or sections printed after the invoice.
export default function ExtraSectionsPanel({
  extraSections, setExtraSections,
}) {
  return (
          <div className="glass-panel p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="section-title" style={{ margin: 0 }}>Additional Pages / Sections</h3>
              <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => setExtraSections(prev => [...prev, { id: Date.now().toString(), title: '', content: '' }])}>
                <Plus size={15} /> Add Section
              </button>
            </div>
            <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
              Add extra sections that appear after the invoice footer. You can paste formatted HTML content (bold, lists, tables, etc.).
            </p>
            {extraSections.length === 0 ? (
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>No extra sections. Click "Add Section" to create one.</p>
            ) : (
              extraSections.map((section, idx) => (
                <div key={section.id} className="extra-section-editor">
                  <div className="flex gap-2 items-center mb-2">
                    <input type="text" className="form-input" value={section.title}
                      onChange={(e) => setExtraSections(prev => prev.map(s => s.id === section.id ? { ...s, title: e.target.value } : s))}
                      placeholder="Section title (e.g. Scope of Work, Delivery Timeline)" style={{ flex: 1 }} />
                    <button className="icon-btn" onClick={() => {
                      if (idx > 0) setExtraSections(prev => { const arr = [...prev]; [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; return arr; });
                    }} title="Move up" disabled={idx === 0}><ChevronUp size={14} /></button>
                    <button className="icon-btn" onClick={() => {
                      if (idx < extraSections.length - 1) setExtraSections(prev => { const arr = [...prev]; [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]; return arr; });
                    }} title="Move down" disabled={idx === extraSections.length - 1}><ChevronDown size={14} /></button>
                    <button className="icon-btn icon-btn-red" onClick={() => setExtraSections(prev => prev.filter(s => s.id !== section.id))} title="Remove"><Trash2 size={14} /></button>
                  </div>
                  <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                    <RichEditor
                      value={section.content}
                      onChange={(html) => setExtraSections(prev => prev.map(s => s.id === section.id ? { ...s, content: html } : s))}
                      placeholder="Type or paste formatted content here (supports bold, lists, tables from Word/Docs)..." />
                  </div>
                </div>
              ))
            )}
          </div>
  );
}
