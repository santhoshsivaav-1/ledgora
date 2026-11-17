import { Plus, Trash2, Building2, Save } from 'lucide-react';
import { saveTermsTemplate } from '../../lib/data';
import { toast } from '../../components/ui/Toast';

function EditIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
    </svg>
  );
}

export function BusinessProfilesSection({ profile, businessProfiles, branches, me, canManageBranches, onAddBranch, handleAddNewProfile, handleSaveAsProfile, handleLoadProfile, handleDeleteProfile }) {
  return (
    <>
      {/* ---- Multi-Business Profiles ---- */}
      {/* v1.10.36 — Moved from ~line 1300 (was 500+ lines below the
           Company Details form) to sit immediately after it. Natural
           flow: fill Company Details → Save as Profile → see it in the
           switcher below. Prior placement forced users to scroll past
           9 sections to find the switcher. */}
      <div id="section-profiles" data-settings-tab="business" className="glass-panel p-6 mb-6" style={{ order: 2 }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="section-title" style={{ margin: 0 }}>Business Profiles</h3>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={handleAddNewProfile}>
              <Plus size={16} /> Add New Profile
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSaveAsProfile}>
              <Building2 size={16} /> Save as Profile
            </button>
          </div>
        </div>
        <p className="page-subtitle mb-4">
          Save multiple business profiles and switch between them instantly. Switching auto-saves your current profile first.
        </p>
        {branches && (
          <div className="template-card" style={{ marginBottom: '1rem', borderColor: 'var(--primary)' }}>
            <div className="template-card-header">
              <div>
                <strong><Building2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Organization branches</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  {me?.organization?.name} · {branches.length} branch{branches.length === 1 ? '' : 'es'} · shared with your whole team
                </span>
              </div>
              {canManageBranches && (
                <button type="button" className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }} onClick={onAddBranch}>
                  <Plus size={14} style={{ verticalAlign: 'middle' }} /> Add branch
                </button>
              )}
            </div>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {branches.map(b => (
                <li key={b.id} style={{ marginBottom: '0.25rem' }}>
                  <strong>{b.name}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {b.gstin ? ` · ${b.gstin}` : ' · no GSTIN yet'}{b.state ? ` · ${b.state}` : ''}
                    {(b.address || b.city) ? ` · ${[b.address, b.city].filter(Boolean).join(', ')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted" style={{ fontSize: '0.78rem', margin: '0.5rem 0 0' }}>
              Branches are the businesses of your organization. Switch between them from the
              branch switcher in the sidebar; members only see the branches they were given.
            </p>
          </div>
        )}
        {businessProfiles.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>
            No saved profiles yet. Fill in your business details above and click "Save as Profile".
          </p>
        ) : (
          <div className="template-list">
            {businessProfiles.map(bp => {
              const isActive = bp.businessName?.trim().toLowerCase() === profile.businessName?.trim().toLowerCase();
              return (
              <div key={bp.id} className="template-card" style={isActive ? { borderColor: 'var(--primary)', borderWidth: '2px' } : {}}>
                <div className="template-card-header">
                  <div>
                    <strong>{bp.businessName}</strong>
                    {isActive && <span style={{ fontSize: '0.68rem', background: 'var(--primary)', color: '#fff', borderRadius: '4px', padding: '0.1rem 0.4rem', marginLeft: '0.5rem' }}>Active</span>}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      {bp.state}{bp.gstin ? ` | ${bp.gstin}` : ''}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                      onClick={() => handleLoadProfile(bp)} disabled={isActive}>
                      {isActive ? 'Current' : 'Switch'}
                    </button>
                    <button className="icon-btn icon-btn-red" onClick={() => handleDeleteProfile(bp.id)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {bp.address && <p className="template-card-preview">{bp.address}</p>}
              </div>
            );
            })}
          </div>
        )}
      </div>
    </>
  );
}


export function TermsTemplatesSection({ termsTemplates, editingTemplate, setEditingTemplate, handleSaveTemplate, handleDeleteTemplate, reloadTemplates }) {
  return (
    <>
      {/* ---- Terms Templates ---- */}
      <div id="section-terms" data-settings-tab="documents" className="glass-panel p-6 mb-6" style={{ order: 3 }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="section-title" style={{ margin: 0 }}>Terms & Conditions Templates</h3>
          <button type="button" className="btn btn-secondary" onClick={() => setEditingTemplate({ id: '', name: '', content: '' })}>
            <Plus size={16} /> New Template
          </button>
        </div>
        <p className="page-subtitle mb-4">Create reusable templates or pick from ready-made ones below.</p>

        {/* Quick Templates */}
        {!editingTemplate && (
          <div className="quick-templates-section">
            <p className="form-label" style={{ marginBottom: '0.5rem' }}>Quick Start — Pick a template for your business:</p>
            <div className="quick-templates-grid">
              {[
                { name: 'Services (IT, Consulting, Freelance)', content: '1. Payment is due within 15 days of invoice date via NEFT/RTGS/UPI unless otherwise agreed.\n2. Late payment interest of 18% per annum will apply on overdue amounts as per MSME Act, 2006.\n3. All amounts are exclusive of GST (CGST/SGST/IGST) as applicable under the GST Act, 2017.\n4. Services rendered are non-refundable once delivered and accepted by the client.\n5. TDS (if applicable) must be deducted as per Income Tax Act. Please share TDS certificate (Form 16A) within 15 days.\n6. All deliverables remain the intellectual property of the service provider until full payment is received.\n7. Any disputes shall be subject to the exclusive jurisdiction of courts in the service provider\'s city.\n8. This is a computer-generated invoice and does not require a physical signature.' },
                { name: 'Goods & Products (Retail, Wholesale)', content: '1. Goods once sold will not be taken back or exchanged unless defective as per Consumer Protection Act, 2019.\n2. Payment is due on delivery via Cash/UPI/NEFT unless credit terms are agreed in advance.\n3. Warranty (if applicable) covers manufacturing defects only as per terms mentioned on the product.\n4. All prices are inclusive of GST (CGST + SGST / IGST) as shown on this invoice.\n5. Claims for damaged or missing items must be reported within 48 hours of delivery with photos.\n6. E-way bill is generated for consignments exceeding Rs. 50,000 as per GST rules.\n7. Risk of loss passes to the buyer upon dispatch from our godown/warehouse.\n8. Subject to jurisdiction of courts at the seller\'s place of business.\n9. This is a computer-generated invoice and does not require a physical signature.' },
                { name: 'Manufacturing & Trading', content: '1. All prices are ex-factory/ex-godown unless otherwise specified.\n2. Payment terms: 50% advance via NEFT/RTGS, balance before dispatch (or as per agreed credit terms).\n3. Goods dispatched only after full payment or confirmed credit arrangement.\n4. Quality complaints must be raised within 7 days of receipt with photographic evidence.\n5. Returns accepted only for manufacturing defects, subject to inspection at our premises.\n6. GST, freight, insurance, loading/unloading charges are as per agreement or additional to quoted price.\n7. E-way bill will be generated as per Section 68 of CGST Act for applicable consignments.\n8. Force majeure: Delays due to natural calamities, strikes, or government orders shall not be held against us.\n9. Interest @ 18% p.a. on overdue payments as per MSME Development Act, 2006.\n10. Subject to exclusive jurisdiction of courts at the seller\'s registered office.\n11. This is a computer-generated invoice and does not require a physical signature.' },
                { name: 'Export / International', content: '1. All prices are in the agreed currency (USD/EUR/GBP) and exclusive of local taxes/duties in buyer\'s country.\n2. Payment via wire transfer (SWIFT/TT) within 30 days of invoice date as per RBI guidelines.\n3. Supply is zero-rated under GST — exported under Letter of Undertaking (LUT) / Bond.\n4. Title and risk pass to buyer upon delivery to carrier (FOB/CIF as per Incoterms 2020).\n5. Buyer is responsible for import duties, customs clearance, and local compliance in destination country.\n6. Claims for shortage or damage must be filed within 14 days of receipt with supporting documents.\n7. All payments to be received in INR equivalent or foreign currency as per FEMA regulations.\n8. Disputes shall be resolved through arbitration in India under the Arbitration & Conciliation Act, 1996.\n9. This is a computer-generated invoice and does not require a physical signature.' },
                { name: 'Freelancer (Simple)', content: '1. Payment due within 7 days of invoice via UPI/NEFT/IMPS.\n2. Late payments attract interest @ 2% per month.\n3. 50% advance required before project commencement.\n4. Scope changes after agreement will be quoted and billed separately.\n5. All work remains property of the freelancer until full payment is received.\n6. Cancellation after work begins: completed portion will be billed proportionally.\n7. TDS (if applicable) to be deducted at source. Share Form 16A within 15 days of deduction.\n8. Subject to jurisdiction of courts in the freelancer\'s city.\n9. This is a computer-generated invoice.' },
              ].map((qt, i) => (
                <button key={i} type="button" className="quick-template-btn" onClick={async () => {
                  // v1.10.74 - don't add a second copy when clicked twice
                  if (termsTemplates.some(t => t.name === qt.name)) { toast('You already have this template', 'info'); return; }
                  await saveTermsTemplate({ name: qt.name, content: qt.content });
                  toast(`Added: ${qt.name}`, 'success');
                  reloadTemplates();
                }}>
                  <Plus size={14} /> {qt.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {editingTemplate && (
          <div className="template-editor">
            <div className="form-group">
              <label className="form-label">Template Name</label>
              <input type="text" className="form-input" value={editingTemplate.name}
                onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                placeholder="e.g. Standard Terms, Export Terms" />
            </div>
            <div className="form-group">
              <label className="form-label">Content (paste your terms here)</label>
              <textarea rows="8" className="form-input" value={editingTemplate.content}
                onChange={e => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
                placeholder="Paste or type your terms & conditions..." />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setEditingTemplate(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleSaveTemplate}><Save size={16} /> Save Template</button>
            </div>
          </div>
        )}

        {termsTemplates.length === 0 && !editingTemplate ? (
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>No templates yet.</p>
        ) : (
          <div className="template-list">
            {termsTemplates.map(tpl => (
              <div key={tpl.id} className="template-card">
                <div className="template-card-header">
                  <strong>{tpl.name}</strong>
                  <div className="flex gap-2">
                    <button className="icon-btn icon-btn-blue" onClick={() => setEditingTemplate({ ...tpl })} title="Edit"><EditIcon size={14} /></button>
                    <button className="icon-btn icon-btn-red" onClick={() => handleDeleteTemplate(tpl.id)} title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
                <p className="template-card-preview">{tpl.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

