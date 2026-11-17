import { useState, useEffect, useRef } from 'react';
import { getProfile, saveProfile, getTermsTemplates, saveTermsTemplate, deleteTermsTemplate, getAllProfiles, saveBusinessProfile, deleteBusinessProfile, getRegionMode, setRegionMode, getEnabledModules, setEnabledModules, getStockAlertSettings, saveStockAlertSettings, renameNumberSeries, getInvoiceDisplayOptions, saveInvoiceDisplayOptions } from '../../lib/data';
import { validateTaxId, getCountriesForRegion, findSameBusiness, businessKeyOf, isModuleEnabled } from '../../utils';
import { Save } from 'lucide-react';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import PrintSettings from '../print/PrintSettings';
import HelpButton from '../../components/ui/HelpButton';
import PrivacyRequests from './PrivacyRequests';
import { TAB_OF } from './tabs';
// Phase 3 split — each Settings section now lives in its own sibling file.
import SettingsCompanySection from './SettingsCompanySection';
import { BusinessProfilesSection, TermsTemplatesSection } from './SettingsBusinessTab';
import { StockAlertsSection, ModulesSection, RegionSection } from './SettingsFeatureTab';
import SettingsDataSection, { BackupAndTrashPanel } from './SettingsDataTab';

// v1.10.36 — Section order for the jump-nav pill bar. Keeping this at
// module scope so the scroll-spy effect below can reference it without
// re-computing on every render.
const JUMP_NAV_SECTIONS = [
  ['section-company',  'Company'],
  ['section-profiles', 'Profiles'],
  ['section-terms',    'Terms'],
  ['section-print',    'Print & PDF'],
  ['section-modules',  'Features'],
  ['section-stock',    'Stock'],
  ['section-region',   'Region'],
  ['section-backups',  'Backups'],
  ['section-data',     'Import/Export'],
];

export default function SettingsView({ onSaved, me, branches, canManageBranches, onAddBranch, tab = 'all' }) {
  const jumpSections = JUMP_NAV_SECTIONS.filter(([id]) => tab === 'all' || TAB_OF[id] === tab);
  const [profile, setProfile] = useState({
    businessName: '', address: '', state: '', gstin: '', pan: '',
    email: '', phone: '', bankName: '', accountNumber: '', ifsc: '',
    logo: '', logoHeight: 48, signature: '', signatureHeight: 60, stamp: '', stampHeight: 70, upiId: '', googleClientId: '', googleDriveFolder: 'GST Billing Invoices',
  });
  // v1.10.36 — Scroll-spy: which section is currently in the viewport,
  // so the corresponding pill lights up as the user scrolls. Cheap
  // IntersectionObserver — a single observer watching all 11 sections;
  // fires when any crosses the top-of-viewport band.
  const [activeSection, setActiveSection] = useState(jumpSections[0]?.[0]);

  // v1.10.55 — reported (#43, @sangwanmail-eng): "Some time details not save
  // after update in setting tab", and the title said there was no save button
  // at all.
  //
  // There is one, but the Company form runs ~450 lines of UI and its only
  // Save button sits at the very bottom. Edit your GSTIN near the top, scroll
  // on to another section, and nothing on screen tells you the change is
  // still unsaved — leave the page and it is gone.
  //
  // It reads as "sometimes" because this page mixes three persistence models
  // with no visible difference between them: Features toggles save silently
  // on click, Region saves on click and shows a toast, while Company, Invoice
  // Numbers and Terms each need their own button. Some edits stick, some
  // vanish, and the UI gives the user no way to predict which.
  //
  // Fix: track whether the profile differs from what was last persisted and
  // surface a sticky bar while it does, so the save is reachable from
  // anywhere on the page and unsaved work is never silent.
  const savedProfileRef = useRef(null);
  const [profileDirty, setProfileDirty] = useState(false);
  // v1.10.75 - the Company form stays locked until the saved profile has
  // loaded. On a slow PC, anything typed before then was silently replaced
  // when the load finished (found by the release gate on a busy machine).
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Both the save bar and the "Jump to" bar stick to the top. They used to
  // share top: 0, so the save bar sat on top of the jump bar and hid it. The
  // jump bar now sticks just below the save bar, measured live because the
  // save bar wraps to two lines on narrow screens.
  const saveBarRef = useRef(null);
  const [saveBarH, setSaveBarH] = useState(56);
  useEffect(() => {
    const el = saveBarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setSaveBarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // v1.10.56 — reported (#44, @sangwanmail-eng): "Firm profile setting not
  // saved. every time show popup".
  //
  // The profile was in fact saving fine. The v1.10.55 unsaved-changes
  // tracker was wrong: it recorded the on-disk baseline in handleSave only,
  // but the profile is persisted from THREE places —
  //   1. handleSave              (the Save Profile button)
  //   2. updateAccounts          (payment accounts auto-persist, v1.10.16)
  //   3. handleLoadProfile       (switching business profile)
  // After 2 or 3, the data was on disk but the baseline still held the older
  // copy, so the bar insisted there were unsaved changes forever — and the
  // beforeunload guard then threw a browser confirm dialog on every close.
  // That popup is what the user was seeing.
  //
  // Fix: one helper, called from every path that persists, so the baseline
  // can never drift from what is actually stored.
  const markProfileSaved = (p) => {
    savedProfileRef.current = JSON.stringify(p);
    setActiveBusiness(p);
    setProfileDirty(false);
  };

  // Recompute against the persisted baseline whenever the form changes.
  // Compared by value, not by "did an onChange fire", so typing a character
  // and deleting it again correctly leaves you clean.
  useEffect(() => {
    if (savedProfileRef.current === null) return; // profile not loaded yet
    setProfileDirty(JSON.stringify(profile) !== savedProfileRef.current);
  }, [profile]);

  // v1.10.56 — the beforeunload confirm added in v1.10.55 is GONE.
  // Even with the baseline bug fixed it was the wrong tool: it hijacks the
  // browser's own close dialog for a form the user may have no intention of
  // saving, and any future drift in the dirty check turns straight into a
  // popup on every exit. The sticky bar already makes unsaved work visible
  // without interrupting anyone.
  useEffect(() => {
    const els = jumpSections
      .map(([id]) => document.getElementById(id))
      .filter(Boolean);
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      // Multiple sections may be in view at once. Pick the top-most
      // one that's still intersecting so the highlight tracks the
      // section the user is actually reading.
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible?.target?.id) setActiveSection(visible.target.id);
    }, {
      // Fires when a section enters the top 40% band — feels natural
      // while scrolling because the section header is usually the
      // trigger point (not the entire panel).
      rootMargin: '-10% 0px -50% 0px',
      threshold: 0.01,
    });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
  const [saving, setSaving] = useState(false);
  const [termsTemplates, setTermsTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [businessProfiles, setBusinessProfiles] = useState([]);
  // v1.10.79 - Invoice Number Format is its own component (InvoiceNumberSettings);
  // the page's "Save all" bar talks to it through this ref and two flags.
  const invNumRef = useRef(null);
  const [invNumDirty, setInvNumDirty] = useState(false);
  const [invNumSaving, setInvNumSaving] = useState(false);
  // The business this page belongs to (as saved), for its own numbering (#95).
  const [activeBusiness, setActiveBusiness] = useState(null);
  const [regionMode, setRegionModeState] = useState(getRegionMode());
  const [enabledModules, setEnabledModulesState] = useState(getEnabledModules());
  const [stockAlerts, setStockAlerts] = useState({ enabled: true, threshold: 5 });
  const [stockAlertsSaving, setStockAlertsSaving] = useState(false);
  // v1.10.75 - what is on disk for the forms that have their own Save, so
  // the bottom "Save all changes" bar knows what is still unsaved.
  const [stockSaved, setStockSaved] = useState(null);

  const toggleModule = (moduleId) => {
    const next = { ...enabledModules, [moduleId]: !isModuleEnabled(moduleId, enabledModules) };
    setEnabledModulesState(next);
    setEnabledModules(next);
  };

  const resetModules = () => {
    setEnabledModulesState({});
    setEnabledModules({});
    // v1.10.74 - defaults keep some features off (e.g. TDS/TCS), so don't say "all visible"
    toast('Features reset to default', 'success');
  };

  const companyFormRef = useRef(null);
  const visibleCountries = getCountriesForRegion(regionMode);

  const handleRegionChange = (mode) => {
    setRegionModeState(mode);
    setRegionMode(mode);
    toast(`Region preference: ${mode === 'india' ? 'India only' : mode === 'international' ? 'International only' : 'Both'}`, 'success');
  };

  useEffect(() => {
    getProfile().then((p) => {
      setProfile(p);
      // Baseline for the unsaved-changes check — what is currently on disk.
      savedProfileRef.current = JSON.stringify(p);
      setActiveBusiness(p);
    }).catch(() => {}).finally(() => setProfileLoaded(true));
    loadTemplates();
    loadBusinessProfiles();
    getStockAlertSettings().then((v) => { setStockAlerts(v); setStockSaved(JSON.stringify(v)); }).catch(() => {});
  }, []);

  const loadTemplates = async () => setTermsTemplates(await getTermsTemplates());
  const loadBusinessProfiles = async () => setBusinessProfiles(await getAllProfiles());

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      await saveProfile(profile);
      // v1.10.79 (#95) - saved under a new GSTIN or name: its own numbering follows.
      const oldKey = businessKeyOf(activeBusiness);
      const newKey = businessKeyOf(profile);
      if (oldKey && newKey && oldKey !== newKey) await renameNumberSeries(oldKey, newKey).catch(() => {});
      // v1.10.16 — reported: "uploaded logo and saved but it's not showing on
      // invoice". Root cause was a stale `freegstbill_invoiceOptions.showLogo`
      // in localStorage from before the upload — DEFAULT_OPTIONS has it true,
      // but a false persisted from an earlier state kept it hidden even after
      // the upload. Now: whenever the user saves a profile that has a logo,
      // we force `showLogo: true` in the persisted invoice options. Same for
      // signature. Users who consciously want to hide the logo can still
      // uncheck it in the Customize panel — this fix only rescues the
      // silent-fail case.
      //
      // v1.10.36 — Reported again: "not able to set logo it show nothing
      // after saving". Root cause of the recurrence: v1.10.16 only wrote
      // to localStorage, but InvoiceGenerator fetches display options
      // from the SERVER on mount (see line ~631) and merges those over
      // the localStorage value. So a stale server-side `showLogo:false`
      // kept overriding the local override. Fix: PUSH the updated
      // display options to the server too — one API call keeps both
      // stores in sync. Non-blocking (.catch()) so a slow server
      // doesn't delay the "Profile saved" toast.
      if (profile.logo || profile.signature) {
        try {
          const raw = localStorage.getItem('freegstbill_invoiceOptions');
          const opts = raw ? JSON.parse(raw) : {};
          if (profile.logo) opts.showLogo = true;
          if (profile.signature) opts.showSignature = true;
          localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(opts));
          // Also sync to server so InvoiceGenerator's mount-load doesn't
          // overwrite our fix with a stale server-side value.
          try {
            const serverOpts = await getInvoiceDisplayOptions().catch(() => null);
            const merged = { ...(serverOpts || {}), ...opts };
            saveInvoiceDisplayOptions(merged).catch(() => { /* non-blocking */ });
          } catch { /* server unreachable — localStorage still updated */ }
        } catch { /* localStorage full or blocked — skip */ }
      }
      if (onSaved) onSaved(profile);
      // v1.10.55 (#43) — mark this state as the persisted baseline so the
      // unsaved-changes bar disappears.
      markProfileSaved(profile);
      toast('Profile saved!', 'success');
    } catch { toast('Failed to save profile', 'error'); }
    finally { setSaving(false); }
  };

  const saveStockAlerts = async () => {
    setStockAlertsSaving(true);
    try {
      await saveStockAlertSettings(stockAlerts);
      setStockSaved(JSON.stringify(stockAlerts));
      toast('Low-stock alert settings saved', 'success');
    } catch { toast('Failed to save', 'error'); }
    setStockAlertsSaving(false);
  };

  // Terms templates
  const handleSaveTemplate = async () => {
    if (!editingTemplate.name.trim()) { toast('Name required', 'warning'); return; }
    await saveTermsTemplate({ ...editingTemplate });
    toast('Template saved!', 'success');
    setEditingTemplate(null);
    loadTemplates();
  };

  const handleDeleteTemplate = async (id) => {
    if (await confirmAction({
      title: 'Delete this template?',
      message: 'Existing invoices that used this Terms preset keep their text — this only removes the reusable template.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })) { await deleteTermsTemplate(id); toast('Deleted', 'success'); loadTemplates(); }
  };

  // Multi-business profiles
  // The saved profile the form was last loaded from (see findSameBusiness).
  const loadedProfileId = useRef(null);
  const sameSavedBusiness = () => findSameBusiness(businessProfiles, profile,
    businessProfiles.find((bp) => bp.id === loadedProfileId.current));

  const handleSaveAsProfile = async () => {
    if (!profile.businessName.trim()) { toast('Business name required', 'warning'); return; }
    // Update the saved profile of this same business, or create a new one
    const existing = sameSavedBusiness();
    await saveBusinessProfile({ ...profile, id: existing?.id || undefined });
    toast(existing ? 'Profile updated!' : 'Profile saved!', 'success');
    loadBusinessProfiles();
  };

  const handleLoadProfile = async (bp) => {
    // Auto-save current profile before switching (so it's not lost)
    if (profile.businessName?.trim()) {
      const existing = sameSavedBusiness();
      await saveBusinessProfile({ ...profile, id: existing?.id || undefined });
    }
    loadedProfileId.current = bp.id;
    const loaded = { ...bp };
    delete loaded.id;
    setProfile(loaded);
    await saveProfile(loaded);
    // v1.10.56 (#44) — switching profiles persists immediately, so this IS
    // the saved state now.
    markProfileSaved(loaded);
    if (onSaved) onSaved(loaded);
    toast(`Switched to ${bp.businessName}`, 'success');
  };

  const handleDeleteProfile = async (id) => {
    if (await confirmAction({
      title: 'Delete this saved business profile?',
      message: 'Invoices already saved under this profile stay untouched. Only removes the profile from your saved list.',
      confirmLabel: 'Delete profile',
      tone: 'danger',
    })) {
      await deleteBusinessProfile(id);
      toast('Profile deleted', 'success');
      loadBusinessProfiles();
    }
  };

  // v1.10.67 (#66 item 3, @sangwanmail-eng) — park the company that is on
  // screen into Business Profiles BEFORE clearing the form. This used to just
  // blank the fields, so the next Save wrote the new company over the old one
  // - and on a fresh install the old one had never been saved as a profile,
  // which meant it was gone for good. Clearing also resets the unsaved-changes
  // baseline, so an empty form no longer claims you have unsaved work.
  const handleAddNewProfile = async () => {
    const current = profile.businessName?.trim();
    if (current) {
      const existing = sameSavedBusiness();
      try {
        await saveBusinessProfile({ ...profile, id: existing?.id || undefined });
        loadedProfileId.current = null; // the form is about to be a new company
        await loadBusinessProfiles();
      } catch {
        toast('Could not save the current company, so nothing was cleared. Try Save Profile first.', 'error');
        return;
      }
    }
    // #66 item 2 — a second company is almost always in the same country as
    // the first, and this is an India-first app; the browser locale guessed
    // United States on an Indian shop and started them on a US form.
    const blank = {
      businessName: '', address: '', city: '', state: '', pin: '', country: profile.country || 'India',
      gstin: '', pan: '', email: '', phone: '', bankName: '', accountNumber: '', ifsc: '', swift: '',
      logo: '', logoHeight: 48, signature: '', signatureHeight: 60, stamp: '', stampHeight: 70, upiId: '', googleClientId: '', googleDriveFolder: 'GST Billing Invoices',
    };
    setProfile(blank);
    markProfileSaved(blank);
    setTaxIdWarning('');
    toast(current ? `${current} is safe in Business Profiles below - fill in the new company and press Save Profile` : 'Fill in the new company, then press Save Profile', 'info', 6000);
    companyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // v1.10.75 - one Save for the whole page (asked for: "a global save button
  // at the bottom, sticky, that saves all data filled anywhere"). Bank
  // accounts, Features, Region and Print & PDF already save as they change;
  // these are the four that wait for a Save.
  const unsaved = [
    profileDirty && 'Company Details',
    invNumDirty && 'Invoice Number Format',
    stockSaved !== null && JSON.stringify(stockAlerts) !== stockSaved && 'Low-stock alerts',
    !!editingTemplate && 'Terms template',
  ].filter(Boolean);
  const saveAll = async () => {
    if (!unsaved.length) { toast('Everything is already saved', 'info'); return; }
    // The Company form goes through its own submit, so its checks still run.
    if (profileDirty) companyFormRef.current?.requestSubmit();
    const jobs = [];
    if (unsaved.includes('Invoice Number Format')) jobs.push(invNumRef.current?.save());
    if (unsaved.includes('Low-stock alerts')) jobs.push(saveStockAlerts());
    if (editingTemplate) jobs.push(handleSaveTemplate());
    await Promise.all(jobs);
  };
  const discardAll = () => {
    if (profileDirty && savedProfileRef.current) setProfile(JSON.parse(savedProfileRef.current));
    invNumRef.current?.discard();
    if (stockSaved !== null) setStockAlerts(JSON.parse(stockSaved));
    setEditingTemplate(null);
  };

  const [taxIdWarning, setTaxIdWarning] = useState('');
  const handleTaxIdBlur = () => {
    const result = validateTaxId(profile.country, profile.gstin);
    setTaxIdWarning(result.ok ? '' : result.message);
  };

  return (
    <div className="settings-container" data-tab={tab}>
      {/* v1.10.36 — Header lifted with a soft primary-accent gradient
           card, gear glyph in a rounded badge for visual identity, and
           a subtle count chip showing how many sections there are so
           the user has a scale expectation before diving in. */}
      <div className="page-header" style={{
        padding: '1.1rem 1.35rem',
        background: 'linear-gradient(135deg, rgba(var(--primary-rgb), 0.12), var(--card-bg))',
        border: '1px solid var(--border)',
        borderRadius: 12,
        marginBottom: '1.25rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            width: 44, height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, var(--primary), var(--primary-darker))',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.15rem',
            boxShadow: '0 6px 18px rgba(var(--primary-rgb), 0.35)',
          }}>⚙</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Settings</h1>
            <p className="page-subtitle" style={{ margin: '0.15rem 0 0' }}>
              Business profile, branding, integrations & data
              <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: 999, background: 'var(--bg-secondary)', border: '1px solid var(--border)', marginLeft: '0.55rem', fontWeight: 600 }}>
                {jumpSections.length} sections
              </span>
            </p>
          </div>
          <HelpButton title="Settings — how to use" doc="settings">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Company Details</strong> — this is the header block on every invoice. GSTIN drives place-of-supply detection.</li>
              <li><strong>Multi-business profiles</strong> — Save as Profile keeps the current form as a switchable profile; switch between them from the business name at the top of the sidebar.</li>
              <li><strong>Payment Accounts</strong> — add multiple bank / UPI accounts; ⭐ marks the default. Every inline change (add / edit / ⭐ / reorder / delete) auto-saves.</li>
              <li><strong>Invoice Number Settings</strong> — brand prefix, financial-year suffix, padding. Live preview at the bottom.</li>
              <li><strong>Print Settings</strong> — templates, colors, watermark, thermal font size, per-type prefix overrides.</li>
              <li><strong>Trash bin</strong> — deleted invoices stay for 30 days. Your data is backed up continuously on our servers.</li>
              <li><strong>Data Management</strong> — export all or part of your data to one backup file, and import it here or on another computer. Clients and products import from CSV on their own screens.</li>
            </ul>
          </HelpButton>
        </div>
      </div>

      {/* v1.10.75 - the section buttons, pinned at the top. They wrap onto a
           second line rather than scroll sideways (asked for: "top should not
           be scrollable"). Saving moved to one bar at the bottom of the page,
           below. It used to be two stacked sticky bars (~140px), one of them a
           white strip in dark mode from an undefined --card-bg-rgb.
           History: v1.10.36/37 scroll-spy pills; v1.10.55 (#43) unsaved
           Company edits made visible; v1.10.67 (#66 item 9) one Save always
           on screen. */}
      <div ref={saveBarRef} className="settings-bar" style={{
          position: 'sticky',
          zIndex: 30,
          padding: '0.45rem 0.55rem',
          marginBottom: '1.25rem',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)', // solid: content must not show through
          boxShadow: '0 4px 20px rgba(15, 23, 42, 0.08)',
        }}>
        <nav className="settings-jumpnav" aria-label="Settings sections" style={{
          display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center',
        }}>
          {jumpSections.map(([id, label]) => {
            const active = activeSection === id;
            return (
              <a key={id} href={`#${id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(id);
                  // Stop below the sticky bar, not underneath it.
                  if (el) {
                    const offset = saveBarH + 20;
                    el.style.scrollMarginTop = `${offset}px`;
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                style={{
                  fontSize: '0.76rem',
                  fontWeight: active ? 700 : 600,
                  padding: '0.38rem 0.8rem',
                  borderRadius: 999,
                  background: active
                    ? 'linear-gradient(135deg, var(--primary), var(--primary-darker))'
                    : 'var(--bg-secondary)',
                  color: active ? '#fff' : 'var(--text)',
                  textDecoration: 'none',
                  border: active ? '1px solid transparent' : '1px solid var(--border)',
                  transition: 'all 0.18s ease',
                  whiteSpace: 'nowrap',
                  boxShadow: active ? '0 4px 12px rgba(var(--primary-rgb), 0.4)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--primary-light, rgba(30,64,175,0.08))';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}>
                {label}
              </a>
            );
          })}
        </nav>
      </div>

      {/* v1.10.37 — Flex-column wrapper for visual reordering. Each
           section keeps its DOM position (safe for the anchor IDs +
           scroll-spy IntersectionObserver + tab order for the primary
           actions) but the CSS `order:` on each section root controls
           the on-screen sequence. Reported: "if you click on first
           Company it goes down then if you click on Profiles comes up
           — should be sorted in a way the pages". Now the on-screen
           order matches the jump-nav pill order exactly.
           Target: Company → Profiles → Terms → Print & PDF → Features
           → Stock → Region → Backups → Google Drive → Import/Export
           → Updates. */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ---- Stock Alerts ---- (see SettingsFeatureTab) ---- */}
      <StockAlertsSection stockAlerts={stockAlerts} setStockAlerts={setStockAlerts}
        stockAlertsSaving={stockAlertsSaving} saveStockAlerts={saveStockAlerts} />

      {/* ---- Thermal Printer Settings ---- */}
      <div id="section-print" data-settings-tab="documents" style={{ order: 4 }}><PrintSettings /></div>

      {/* v1.9.5 — Backup Management + Trash Bin */}
      <div id="section-backups" data-settings-tab="data" style={{ order: 8 }}><BackupAndTrashPanel /></div>

      {/* ---- Modules / Features ---- (see SettingsFeatureTab) ---- */}
      <ModulesSection enabledModules={enabledModules} toggleModule={toggleModule}
        resetModules={resetModules} regionMode={regionMode} />

      {/* ---- Region Preference ---- (see SettingsFeatureTab) ---- */}
      <RegionSection regionMode={regionMode} handleRegionChange={handleRegionChange} />

      {/* ---- Business Profile: Company Details, Payment Accounts, Invoice
           Number Format and Branding (see SettingsCompanySection) ---- */}
      <SettingsCompanySection profile={profile} setProfile={setProfile} handleChange={handleChange}
        taxIdWarning={taxIdWarning} setTaxIdWarning={setTaxIdWarning} handleTaxIdBlur={handleTaxIdBlur}
        visibleCountries={visibleCountries} profileLoaded={profileLoaded}
        saving={saving} handleSave={handleSave} companyFormRef={companyFormRef}
        markProfileSaved={markProfileSaved} invNumRef={invNumRef}
        activeBusiness={activeBusiness} businessProfiles={businessProfiles}
        onInvNumDirtyChange={setInvNumDirty} onInvNumSavingChange={setInvNumSaving} />

      {/* ---- Multi-Business Profiles ---- (see SettingsBusinessTab) ---- */}
      <BusinessProfilesSection profile={profile} businessProfiles={businessProfiles}
        branches={branches} me={me} canManageBranches={canManageBranches} onAddBranch={onAddBranch}
        handleAddNewProfile={handleAddNewProfile} handleSaveAsProfile={handleSaveAsProfile}
        handleLoadProfile={handleLoadProfile} handleDeleteProfile={handleDeleteProfile} />

      {/* ---- Terms Templates ---- (see SettingsBusinessTab) ---- */}
      <TermsTemplatesSection termsTemplates={termsTemplates} editingTemplate={editingTemplate}
        setEditingTemplate={setEditingTemplate} handleSaveTemplate={handleSaveTemplate}
        handleDeleteTemplate={handleDeleteTemplate} reloadTemplates={loadTemplates} />

      {/* v1.10.36 — Multi-Business Profiles block relocated above,
           immediately after the Company Details form. Placeholder here
           kept as a comment so a code search for "Multi-Business
           Profiles" still lands somewhere sensible. */}

      {(tab === 'all' || tab === 'data') && <PrivacyRequests />}

      {/* ---- Data Management + Export/Import modals (see SettingsDataTab) ---- */}
      <SettingsDataSection
        onProfileRestored={(p) => { setProfile(p); if (onSaved) onSaved(p); }}
        onTemplatesRestored={loadTemplates} onProfilesRestored={loadBusinessProfiles} />

      {/* v1.10.37 — end of flex-column reorder wrapper (opened after the
           jump-nav). Modal below stays outside so its z-index isn't
           captured by the flex context. */}
      </div>

      {/* v1.10.75 - Save all changes, docked flat along the bottom edge of the
           screen (asked for: stuck to the bottom, not floating). Position and
           width are in index.css (.settings-savebar). */}
      <div className="settings-savebar" style={{
          zIndex: 40,
          display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
          padding: '0.6rem 1.5rem',
          borderTop: unsaved.length ? '2px solid #f59e0b' : '1px solid var(--border)',
          background: unsaved.length ? 'color-mix(in srgb, #f59e0b 8%, var(--bg-secondary))' : 'var(--bg-secondary)',
          boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.10)',
        }}>
        <span style={{ flex: '1 1 220px', fontSize: '0.85rem', fontWeight: 600, color: unsaved.length ? '#f59e0b' : 'var(--text-muted)' }}
          title="Bank accounts, Features, Region and Print & PDF save as you change them.">
          {unsaved.length ? <>● Unsaved changes in {unsaved.join(', ')}</> : '✓ All changes saved'}
        </span>
        {unsaved.length > 0 && (
          <button type="button" className="btn" onClick={discardAll} style={{ fontSize: '0.85rem' }}>Discard</button>
        )}
        <button type="button" className="btn btn-primary" disabled={saving || invNumSaving || stockAlertsSaving} onClick={saveAll} style={{ fontSize: '0.85rem' }}>
          <Save size={16} /> {saving || invNumSaving || stockAlertsSaving ? 'Saving…' : 'Save all changes'}
        </button>
      </div>
    </div>
  );
}
