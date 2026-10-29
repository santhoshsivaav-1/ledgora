import { Download, Upload } from 'lucide-react';
import { GSTR1_STEPS, GSTR3B_STEPS, NIL_GSTR1_STEPS, NIL_GSTR3B_STEPS, StepList } from './gstHelpers';

// The filing checklist and guide. One page of GST returns (change 3.17).
export default function FilingGuidePage({
  activeTab, guideTab, setGuideTab,
}) {
  return (
    <>
      {activeTab === 'guide' && (
        <>
          {/* Quick Start */}
          <div className="glass-panel" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem', borderLeft: '3px solid var(--primary)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              <strong>Steps:</strong> Review GSTR-1 & 3B tabs → Export JSON → Upload to gst.gov.in → File GSTR-1 first, then GSTR-3B.
              <span style={{ color: 'var(--text-muted)' }}> | Due: R1 by 11th, 3B by 20th of next month | Late fee: ₹50/day</span>
            </p>
          </div>

          {/* Tab selector within guide */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {[
                    { id: 'regular', label: 'Regular Filing (With Sales)' },
                    { id: 'nil', label: 'NIL Return (No Sales)' },
                    { id: 'errors', label: 'Common Errors & Fixes' },
                  ].map(tab => (
                    <button key={tab.id} className={`btn ${guideTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setGuideTab(tab.id)} style={{ fontSize: '0.82rem' }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {guideTab === 'regular' && (
                  <>
                    <StepList steps={GSTR1_STEPS} title="GSTR-1 — Sales Return (File This First)" />

                    <div className="glass-panel p-4 mb-4" style={{ background: '#f0fdf4' }}>
                      <h4 style={{ color: '#059669', marginBottom: '0.5rem', fontSize: '0.9rem' }}>GSTR-1 Pro Tips</h4>
                      <ul style={{ fontSize: '0.82rem', color: '#047857', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                        <li><strong>Fastest method:</strong> Export GSTR-1 JSON from the GSTR-1 tab above → Go to GST portal → GSTR-1 → Prepare Offline → Download Offline Tool → Import JSON → Upload. Saves 90% of time.</li>
                        <li>If turnover {'<'} ₹5 Cr, opt for QRMP scheme — file quarterly instead of monthly. Apply via Services → User Services → Opt-in for QRMP.</li>
                        <li>Amendments to previous period invoices: Use Table 9A (not 4A). You can amend within the September return of the following FY.</li>
                        <li>Export invoices (zero-rated): Report in Table 6A with shipping bill details.</li>
                        <li>Advances received: Report in Table 11A (tax on advance received) — adjust when invoice is issued (Table 11B).</li>
                      </ul>
                    </div>

                    <StepList steps={GSTR3B_STEPS} title="GSTR-3B — Summary Return + Tax Payment (File After GSTR-1)" />

                    <div className="glass-panel p-4 mb-4" style={{ background: '#eff6ff' }}>
                      <h4 style={{ color: 'var(--primary)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>GSTR-3B Pro Tips</h4>
                      <ul style={{ fontSize: '0.82rem', color: '#1e40af', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                        <li><strong>From July 2025:</strong> Table 3 auto-populates from GSTR-1 — just VERIFY, don't re-enter values.</li>
                        <li><strong>ITC matching:</strong> Always check GSTR-2B statement BEFORE claiming ITC. Go to Returns → GSTR-2B → Download. Only claim ITC that appears in GSTR-2B.</li>
                        <li><strong>ITC utilization order (Section 49):</strong> IGST credit first (against IGST → CGST → SGST), then CGST (against CGST → IGST), then SGST (against SGST → IGST).</li>
                        <li><strong>Payment:</strong> Use Electronic Credit Ledger (ITC) first. Pay remaining via Electronic Cash Ledger. Create challan via Services → Payments → Create Challan.</li>
                        <li><strong>Interest calculation:</strong> If you file late, interest is 18% p.a. calculated on tax payable (not total liability). Interest starts from day after due date.</li>
                        <li><strong>Reverse charge:</strong> If you paid RCM (restaurant/legal/GTA services), report in 3.1(d) AND claim ITC in Table 4(A)(3).</li>
                      </ul>
                    </div>
                  </>
                )}

                {guideTab === 'nil' && (
                  <>
                    <div className="glass-panel p-4 mb-4" style={{ borderLeft: '4px solid #f59e0b', background: 'var(--warn-bg)', color: 'var(--warn-text)' }}>
                      <h4 style={{ color: '#92400e', marginBottom: '0.5rem', fontSize: '0.9rem' }}>When to File NIL Return</h4>
                      <ul style={{ fontSize: '0.85rem', color: '#a16207', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                        <li>You had <strong>ZERO outward supplies</strong> (no sales/services) during the period</li>
                        <li>You have <strong>NO input tax credit</strong> to claim</li>
                        <li>You have <strong>NO tax liability</strong> (including reverse charge)</li>
                        <li>You have <strong>NO inward supplies</strong> liable to reverse charge</li>
                        <li>If ANY of the above has a value, you MUST file a regular return — not NIL</li>
                      </ul>
                      <p style={{ fontSize: '0.85rem', color: '#92400e', marginTop: '0.5rem', fontWeight: 600 }}>
                        MANDATORY: You must file NIL returns every month/quarter even with zero activity. Non-filing for 6 continuous months can result in suo-motu GSTIN cancellation under Section 29(2)(c).
                      </p>
                    </div>

                    <StepList steps={NIL_GSTR1_STEPS} title="NIL GSTR-1 — File First (Even with Zero Sales)" />
                    <StepList steps={NIL_GSTR3B_STEPS} title="NIL GSTR-3B — File After NIL GSTR-1" />

                    <div className="glass-panel p-4" style={{ background: '#f0fdf4' }}>
                      <h4 style={{ color: '#059669', marginBottom: '0.5rem', fontSize: '0.9rem' }}>NIL Return Quick Summary</h4>
                      <ul style={{ fontSize: '0.82rem', color: '#047857', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                        <li>NIL GSTR-1 and NIL GSTR-3B are <strong>separate returns</strong> — file both</li>
                        <li>NIL filing takes 2-3 minutes per return — just login, verify zeros, submit, file</li>
                        <li>Late fee for NIL: ₹20/day (₹10 CGST + ₹10 SGST), capped at ₹500 per return</li>
                        <li>You can file NIL returns via SMS: Send <code>NIL space GSTIN space Return Period</code> to 14409. Verify with OTP.</li>
                        <li>QRMP users filing quarterly: NIL return covers the entire quarter</li>
                        <li>Even if you had no sales but had purchases with GST → file REGULAR return (not NIL) to claim ITC</li>
                      </ul>
                    </div>
                  </>
                )}

                {guideTab === 'errors' && (
                  <>
                    <div className="glass-panel mb-4">
                      <div className="table-header"><h3>Common GST Portal Errors & How to Fix Them</h3></div>
                      <div style={{ padding: '1rem 1.25rem' }}>
                        {[
                          { error: '"Invalid GSTIN" when adding B2B invoice', fix: 'Verify the client GSTIN on the portal: Services → User Services → Search Taxpayer. The GSTIN must be active. Cancelled/surrendered GSTINs are rejected. Also check for typos — GSTIN is 15 characters: 2 digits (state) + 10 chars (PAN) + 1 entity code + 1 check digit.' },
                          { error: '"Invoice number already exists for this recipient"', fix: 'Each invoice number must be unique per GSTIN per period. If you\'re re-filing after amendment, use Table 9A for amendments, not Table 4A. If duplicate, check if invoice was already reported in a previous period.' },
                          { error: '"Place of Supply mismatch" or wrong tax type', fix: 'If supply is INTER-STATE (different states), only IGST applies. If INTRA-STATE (same state), only CGST+SGST. POS must match the buyer\'s state for inter-state. Common mistake: Delhi business billing Delhi client but selecting different POS.' },
                          { error: '"Invoice date is not within the return period"', fix: 'Invoice date must fall within the filing period. E.g., for March 2026 return, dates must be 01/03/2026 to 31/03/2026. If you missed an invoice, report in the current period — it\'s allowed but must be before September of next FY.' },
                          { error: '"HSN code is invalid" in Table 12', fix: 'Use valid HSN codes from the official HSN Master (downloadable from cbic.gov.in). Services use SAC codes starting with 99. Common: 998314 (IT services), 9954 (construction), 9983 (professional services). The portal validates against the master list.' },
                          { error: '"GSTR-3B cannot be filed — GSTR-1 not filed"', fix: 'You MUST file GSTR-1 before GSTR-3B for the same period. Go back and file GSTR-1 first. This is a hard block — no workaround.' },
                          { error: '"ITC claimed exceeds GSTR-2B available ITC"', fix: 'You cannot claim more ITC than what\'s in your auto-populated GSTR-2B statement. Check Returns → GSTR-2B to see eligible ITC. If a supplier hasn\'t filed their GSTR-1, their invoice won\'t appear in your GSTR-2B and you can\'t claim that ITC yet.' },
                          { error: '"Previous period return not filed"', fix: 'GST returns must be filed sequentially. You cannot file March return if February is pending. File all pending returns in order starting from the earliest unfiled period.' },
                          { error: '"Taxable value and tax amount mismatch"', fix: 'The portal validates that tax = taxable value × rate. E.g., if taxable value is ₹10,000 at 18%, IGST must be ₹1,800 (or CGST ₹900 + SGST ₹900). Rounding differences up to ₹1 are allowed.' },
                          { error: '"EVC generation failed" or "OTP not received"', fix: 'Try after 5 minutes. Check registered mobile number is correct (Profile → Update). For companies, EVC is not available — use DSC only. If DSC fails, check USB token is inserted and emsigner utility is running.' },
                          { error: '"Challan amount does not match liability"', fix: 'Create challan AFTER submitting GSTR-3B, not before. The challan amount must match the "Tax payable in cash" column. If you overpaid, excess stays in Electronic Cash Ledger for future use or refund.' },
                        ].map((item, i) => (
                          <div key={i} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: i < 10 ? '1px solid var(--border)' : 'none' }}>
                            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#dc2626', marginBottom: '0.25rem' }}>Error: {item.error}</p>
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>Fix: {item.fix}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="glass-panel p-4" style={{ background: '#f8fafc' }}>
                      <h4 style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>Key GST Rules to Remember</h4>
                      <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
                        <li><strong>Section 16(4):</strong> ITC for any invoice must be claimed by the due date of September return of the following FY, or the date of filing annual return — whichever is earlier.</li>
                        <li><strong>Section 34:</strong> Credit notes must be issued before September 30 following the end of FY of the original invoice or annual return filing — whichever is earlier.</li>
                        <li><strong>Section 31:</strong> Tax invoice must be issued at or before the time of supply. For services, within 30 days of supply.</li>
                        <li><strong>Section 49:</strong> ITC utilization order is mandatory: IGST first (against IGST→CGST→SGST), then CGST (→CGST→IGST), then SGST (→SGST→IGST). Cross-utilization of CGST↔SGST is NOT allowed.</li>
                        <li><strong>Rule 36(4):</strong> ITC can only be claimed for invoices that appear in GSTR-2B. No provisional ITC beyond GSTR-2B.</li>
                        <li><strong>Section 50:</strong> Interest on late payment is 18% p.a. on NET tax payable (after ITC). Calculated from the day after due date to date of payment.</li>
                        <li><strong>Section 73/74:</strong> Tax department can issue notice for short payment within 3 years (73) or 5 years for fraud (74). Maintain all records for at least 6 years.</li>
                        <li><strong>Section 29(2)(c):</strong> GSTIN cancellation if returns not filed for 6+ continuous months (quarterly filers: 2 consecutive quarters).</li>
                        <li><strong>E-way Bill:</strong> Cannot generate e-way bills if GSTR-3B not filed for 2+ consecutive months.</li>
                      </ul>
                    </div>
                  </>
                )}
        </>
      )}
    </>
  );
}
