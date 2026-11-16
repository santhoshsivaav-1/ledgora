import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { FileText, Download, X } from 'lucide-react';
import { SETTINGS_TABS } from '@ledgora/contracts';
import {
  getAllProfiles,
  saveProfile,
  saveBusinessProfile,
  getEnabledModules,
  getProfile,
} from './lib/data';
import { searchWorkspace } from './lib/data/search';
import { isModuleEnabled, DOCS_URL } from './utils';
import { listBusinesses, switchOrganization } from './services/session';
// v1.10.4 — Route-level lazy loading. Prior App.jsx synchronously
// imported all 12 views (~15k LOC combined), so a first-paint on
// Dashboard downloaded and parsed GSTReturns (1952), InvoiceGenerator
// (2409), IncomeTax (1038), SettingsView (1479), PrintSettings (1294)
// etc. before the user even asked for them.
//
// Now:
//  - Dashboard stays eager — it's the default landing route.
//  - InvoiceGenerator stays eager — new-invoice is the primary action
//    reachable from Ctrl+K / manifest shortcut / big blue button.
//  - Every other view is React.lazy → own Vite chunk → fetched on
//    first navigation only. Suspense fallback is a lightweight spinner.
// Result: smaller initial JS payload; each heavy view chunk-caches
// once fetched.
import Dashboard from './features/dashboard/Dashboard';
import AnalyticsDashboard from './features/dashboard/AnalyticsDashboard';
import InvoiceGenerator from './features/invoices/editor/InvoiceEditorPage';
import SetupWizard from './features/onboarding/SetupWizard';
import BranchModal from './features/settings/BranchModal';
import { useSession } from './features/auth/SessionContext';
import { loadAppSettings, resetAppSettings } from './lib/appSettings';
import useAutoLock from './app/useAutoLock';
import ToastContainer from './components/ui/Toast';
import { useTheme } from './app/providers';
import NotificationPopover from './app/NotificationBell';
import Sidebar from './app/Sidebar';
import TopBar from './app/TopBar';
import AppShell from './app/AppShell';
import CommandPalette from './app/CommandPalette';
import ShortcutsHelp from './app/ShortcutsHelp';
import UpdateReloadButton from './app/UpdateReloadButton';
import { viewFromPath, pathForView, legacyViewRedirect, canonicalPath, pathsForView, LEGACY_REDIRECTS } from './app/router';
import { FEATURES } from './config/featureFlags';
import { buildClassicNav, NAV, visibleNav, findNavEntry, navScreens, leafPath } from './app/navigation';
import { useUiMode, setUiMode } from './app/uiMode';
import VySidebar from './app/nav/VySidebar';
import VyTopBar from './app/VyTopBar';
import CompanySwitcher from './app/CompanySwitcher';
import OpenAnything from './app/OpenAnything';
import useNotifications from './app/useNotifications';
import { buildPaletteActions } from './app/paletteActions';
import { toast } from './components/ui/Toast';
import { useEntitlements } from './features/billing/useEntitlements';
import LockedFeature from './components/ui/LockedFeature';
import FeatureGuard from './components/ui/FeatureGuard';
import { LoadingState } from './components/ui/States';
import ScreenBoundary from './app/ScreenBoundary';
import ConfirmModalContainer from './components/ui/ConfirmModal';
import WelcomeGuide from './features/onboarding/WelcomeGuide';
/** The Cash & Bank reports moved into the report engine (/reports/:id); old links still land there. */
function CashBankReportRedirect() {
  const { reportId } = useParams();
  return <Navigate to={`/reports/${reportId}`} replace />;
}
function GstReturnsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const valid = ['gstr1', 'gstr3b', 'gstr2b', 'tds', 'guide'];
  if (!valid.includes(tab)) return <Navigate to="/gst-returns/gstr1" replace />;
  return <GSTReturns tab={tab} onTab={(t) => navigate(`/gst-returns/${t}`)} />;
}

// Every screen is its own chunk. A first visit would wait on the network for it, so the few busiest screens are fetched when the
// browser is idle after start-up, and any other when its menu item is hovered or focused (a click then finds the code already
// here). Fetching all forty screens one after the other at start-up competed with the data the page was waiting for.
const viewLoaders = [];
const loaderByView = {};
const warmed = new Set();
const lazyView = (loader, ...viewIds) => {
  viewLoaders.push(loader);
  for (const id of viewIds) loaderByView[id] = loader;
  return lazy(loader);
};
const warmView = (id) => {
  const loader = loaderByView[id];
  if (!loader || warmed.has(id)) return;
  warmed.add(id);
  Promise.resolve(loader()).catch(() => warmed.delete(id));
};
// v1.10.81 — The busiest screens, fetched one at a time when the browser is idle. On a weak
// link (Data Saver on, or 2G / slow-2G) this warm-up races the service worker's first precache
// and the screens' own data calls — part of the reported "first load is slow" — so there a
// screen's code is fetched only when it is actually opened (the hover/focus warm-up below
// still runs, and the service worker caches whatever ends up being fetched).
const HOT_VIEWS = ['clients', 'inventory', 'reports', 'receipts'];
const NO_RECORDS = { bills: [], clients: [], products: [] };
const preloadViews = () => {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.saveData || /^(slow-)?2g$/.test(conn.effectiveType || ''))) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  let i = 0;
  const next = () => {
    if (i >= HOT_VIEWS.length) return;
    warmView(HOT_VIEWS[i++]);
    idle(next);
  };
  idle(next);
};

const SettingsView = lazyView(() => import('./features/settings/SettingsView'), 'settings');
const SettingsLayout = lazyView(() => import('./features/settings/SettingsLayout'));
const SettingsTabPage = lazyView(() => import('./features/settings/registry/SettingsTabPage'));
const BillingPage = lazyView(() => import('./features/billing/BillingPage'));
import PlanBanner from './features/billing/PlanBanner';
const TeamPage = lazyView(() => import('./features/settings/team/TeamPage'));
const RolesPage = lazyView(() => import('./features/settings/team/RolesPage'));
const SecurityPage = lazyView(() => import('./features/settings/security/SecurityPage'));
const AcceptInvitePage = lazyView(() => import('./features/auth/AcceptInvitePage'));
const ClientsView = lazyView(() => import('./features/parties/ClientsView'), 'clients');
const InventoryView = lazyView(() => import('./features/items/InventoryView'), 'inventory');
const BarcodePage = lazyView(() => import('./features/utilities/BarcodePage'), 'barcode');
const TallyPage = lazyView(() => import('./features/utilities/TallyPage'), 'tally');
const CloseFyPage = lazyView(() => import('./features/utilities/CloseFyPage'), 'close-fy');
const BackupPage = lazyView(() => import('./features/utilities/BackupPage'), 'backup');
const SetupPage = lazyView(() => import('./features/utilities/SetupPage'), 'setup');
const TrashPage = lazyView(() => import('./features/utilities/TrashPage'), 'trash');
const PosPage = lazyView(() => import('./features/pos/PosPage'), 'pos');
const ReportsView = lazyView(() => import('./features/reports/ReportsView'), 'reports');
const ExpenseTracker = lazyView(() => import('./features/expenses/ExpenseTracker'), 'expenses', 'other-income');
const RecurringInvoices = lazyView(() => import('./features/recurring/RecurringInvoices'), 'recurring');
const ReceiptVoucher = lazyView(() => import('./features/payments/ReceiptVoucher'), 'receipts');
const SalesmenView = lazyView(() => import('./features/sales/SalesmenView'), 'salesman');
const RemindersPage = lazyView(() => import('./features/grow/RemindersPage'), 'reminders');
const ReturnRegister = lazyView(() => import('./features/filing/ReturnRegister'), 'returns');
const FilingPackPage = lazyView(() => import('./features/filing/FilingPackPage'));
const PracticePage = lazyView(() => import('./features/filing/PracticePage'), 'practice');
const Itr4Page = lazyView(() => import('./features/filing/Itr4Page'), 'itr4');
const Itr3Page = lazyView(() => import('./features/filing/Itr3Page'), 'itr3');
const AssetsPage = lazyView(() => import('./features/assets/AssetsPage'), 'assets');
const EditLogPage = lazyView(() => import('./features/filing/EditLogPage'), 'edit-log');
const CatalogSettingsPage = lazyView(() => import('./features/catalog/CatalogSettingsPage'), 'catalog');
const GSTReturns = lazyView(() => import('./features/gst-returns/GSTReturns'), 'filing');
const IncomeTax = lazyView(() => import('./features/income-tax/IncomeTax'), 'incometax');
const PurchaseBills = lazyView(() => import('./features/purchases/PurchaseBills'), 'purchases');
const PurchaseOrders = lazyView(() => import('./features/purchases/PurchaseOrders'), 'purchase-orders');
const DebitNotes = lazyView(() => import('./features/purchases/DebitNotes'), 'purchase-returns');
const PaymentVoucher = lazyView(() => import('./features/payments/PaymentVoucher'), 'payment-out');
const AccountingPage = lazyView(() => import('./features/accounting/AccountingPage'), 'accounting');
const CashBankPage = lazyView(() => import('./features/cashbank/CashBankPage'), 'cashbank');
const ReportsHub = lazyView(() => import('./features/reports/ReportsHub'));
const ReportPage = lazyView(() => import('./features/reports/ReportPage'));
import AppFooter from './app/AppFooter';
import SalesOverview from './features/sales/SalesOverview';
import { SALES_PAGES, salesPageForView, salesPageForType } from './features/sales/salesFlow';
// The component gallery (/dev/ui) exists in development builds only; Vite drops it from production.
const UiGallery = import.meta.env.DEV ? lazy(() => import('./features/dev/UiGallery')) : null;
import { getPrintSettings, loadPrintSettingsFor, savePrintSettings } from './features/print/printSettingsStore';

const openDocs = () => window.open(DOCS_URL, '_blank', 'noopener,noreferrer');

// v1.10.4 — Lightweight Suspense fallback shown while a lazy view
// downloads. Purely visual — no data fetching, no state.
const ViewLoading = LoadingState;

function App() {
  const { me, signOut } = useSession();
  // The business's typed settings (Settings screen) are loaded once so every screen can obey them (lib/appSettings.js).
  useEffect(() => {
    if (!me) return resetAppSettings();
    loadAppSettings().catch(() => {});
  }, [me?.organization?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useAutoLock(!!me, signOut);
  useEffect(() => {
    if (!me) return undefined;
    preloadViews();
    // A menu item about to be clicked: fetch its screen's code now.
    const warm = (e) => {
      const el = e.target?.closest?.('[data-path], a[href^="/"]');
      const href = el?.getAttribute('data-path') || el?.getAttribute('href');
      if (href?.startsWith('/')) warmView(viewFromPath(href.split(/[?#]/)[0]));
    };
    document.addEventListener('pointerover', warm, { passive: true });
    document.addEventListener('focusin', warm);
    return () => {
      document.removeEventListener('pointerover', warm);
      document.removeEventListener('focusin', warm);
    };
  }, [!!me]); // eslint-disable-line react-hooks/exhaustive-deps
  // v1.9.3 — Setup Wizard shown on first-run (before onboardingComplete = true)
  // Decided once this business's print settings have loaded (see printLoadedFor below).
  const [showWizard, setShowWizard] = useState(false);
  // The screen comes from the URL (change 3.1), so refresh, back/forward and copied links land where they should.
  const location = useLocation();
  const navigate = useNavigate();
  const currentView = viewFromPath(location.pathname);
  const setCurrentView = useCallback((id) => navigate(pathForView(id)), [navigate]);
  const { can, hasFeature } = useEntitlements();
  // Vyapar parity (Phase 0): the `ui.vyapar` flag picks the shell. Off is the classic app, unchanged.
  const vyapar = useUiMode() === 'vyapar';
  // Old PWA shortcuts and bookmarks used /?view=new. A screen with an address in each shell (/clients and /parties)
  // moves to the one this shell uses, so both kinds of bookmark keep working.
  useEffect(() => {
    const target = legacyViewRedirect(location.pathname, location.search) || canonicalPath(location.pathname);
    if (target) navigate(target + (target.includes('?') ? '' : location.search), { replace: true });
  }, [location.pathname, location.search, navigate, vyapar]);
  const [profile, setProfile] = useState(null);
  const [editingBill, setEditingBill] = useState(() => {
    try {
      const saved = sessionStorage.getItem('gst_editingBill');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const { dark: darkMode, toggle: toggleDark } = useTheme();
  const [showWelcome, setShowWelcome] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const deferredPrompt = useRef(null);
  const retryTimer = useRef(null);

  const [serverStatus, setServerStatus] = useState('checking'); // 'checking' | 'online' | 'offline'
  const profileLoaded = useRef(false);
  const [allProfiles, setAllProfiles] = useState([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef(null);

  // ---- Organization branches (signed-in accounts) ----
  // When an account is signed in, the branch (business) list comes from the
  // account server, not the local profiles: it is the same list for every
  // device, and already filtered per member by row-level security. The local
  // profile for a branch is still edited here (logo, payment accounts), and a
  // branch switched to for the first time seeds a fresh profile its fields.
  const [branches, setBranches] = useState(null); // null = never fetched (no account or server offline)
  const [branchTick, setBranchTick] = useState(0); // the new shell's company switcher asks for a fresh list on open
  const [showBranchModal, setShowBranchModal] = useState(false);

  // ---- Notification centre ---- (app/useNotifications.js)
  const { notifications, isLive, notifTotal, dismissableCount, markAllNotifsRead } = useNotifications(currentView);
  const [showNotifs, setShowNotifs] = useState(false);

  // ---- Keyboard shortcuts + command palette ----
  // Ctrl+K opens a Spotlight-style command palette; Ctrl+N starts a new
  // invoice from anywhere; Ctrl+/ shows the full shortcuts list. Ctrl+S /
  // Ctrl+P live in InvoiceGenerator (they need invoice-form context). All
  // global handlers also accept Meta (⌘) for macOS users.
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  // Cross-app search: invoices, parties and items matching what is typed, found by the server (at most 8 of each). Nothing is
  // downloaded until the palette is open and at least two letters are typed.
  const [found, setFound] = useState({ bills: [], clients: [], products: [] });
  const [openAnythingQuery, setOpenAnythingQuery] = useState('');
  const searchText = (vyapar ? openAnythingQuery : paletteQuery).trim();
  const searching = showPalette && searchText.length >= 2;
  useEffect(() => {
    if (!searching) return undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      searchWorkspace(searchText, ctrl.signal).then(setFound, () => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [searching, searchText]);
  const searchCorpus = useMemo(() => (searching ? found : NO_RECORDS), [searching, found]);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Palette useMemo + dependent effects are declared further down, AFTER
  // `navItems` and `handleNewInvoice` exist. Declaring them up here would
  // throw "Cannot access 'X' before initialization" at render time because
  // useMemo's dependency array is evaluated synchronously every render.

  // Check if server is running — continuously monitors
  useEffect(() => {
    let cancelled = false;
    // v1.10.73 - a busy or older PC can take a few seconds to answer. One
    // slow reply used to replace the whole app with "Needs a Quick Start"
    // mid-invoice. Once the app has loaded, it now takes 3 missed checks in a
    // row (about 15 s) before saying the app is not running; before the first
    // load it still says so straight away.
    let misses = 0;

    // Reads the business profile once. A slow or failed read only means "try again at the next check"; it never says the
    // server is down (the hosted database can take several seconds on a cold start).
    let profileBusy = false;
    const loadProfile = async () => {
      if (profileBusy || profileLoaded.current) return;
      profileBusy = true;
      try {
        const p = await getProfile();
        if (cancelled || profileLoaded.current) return;
        profileLoaded.current = true;
        setProfile(p);
        // Not while someone opens an invitation: they are joining a business, not setting one up.
        if (!p.businessName && !localStorage.getItem('freegstbill_onboarded') && !window.location.pathname.startsWith('/accept-invite/')) {
          setShowWelcome(true);
        }
      } catch {
        /* next check tries again */
      } finally {
        profileBusy = false;
      }
    };

    const checkServer = async () => {
      try {
        // Liveness is the cheap /health, never the profile, so a slow database cannot look like a dead server. Any answer
        // means the server is there; only a gateway error (502-504: the host is restarting) counts as a miss.
        const res = await fetch('/health', { signal: AbortSignal.timeout(20000) });
        if (res.status >= 502 && res.status <= 504) throw new Error('gateway');
        if (cancelled) return;
        misses = 0;
        setServerDown(false);
        setServerStatus('online');
        loadProfile();
      } catch {
        if (cancelled) return;
        misses += 1;
        // A cold or restarting host can miss once or twice; two misses in a row before the first load, three after it.
        if (misses >= 3) {
          setServerDown(true);
          setServerStatus('offline');
        }
      }
    };

    // One check at a time: the next is scheduled only after the last one answered, so a slow reply can never pile up
    // requests and starve page navigation of connections. Quick re-check while down or unsure, relaxed when healthy.
    const loop = async () => {
      await checkServer();
      if (cancelled) return;
      retryTimer.current = setTimeout(loop, misses > 0 ? 1500 : 30000);
    };
    loop();

    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  // Capture PWA install prompt. Banner re-appears 14 days after dismissal
  // (was: dismissed forever — too aggressive, users who closed it during
  // a busy moment never saw it again).
  useEffect(() => {
    const dismissedAt = localStorage.getItem('freegstbill_pwa_dismissed_at');
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true; // iOS Safari
    if (isStandalone) return;
    // 14-day cool-down on dismissal
    if (dismissedAt) {
      const days = (Date.now() - Number(dismissedAt)) / 86400000;
      if (days < 14) return;
    }

    const handler = (e) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (editingBill) {
      // _printOnOpen is a one-shot request; a refresh must not print again.
      const { _printOnOpen, ...toKeep } = editingBill;
      sessionStorage.setItem('gst_editingBill', JSON.stringify(toKeep));
    } else {
      sessionStorage.removeItem('gst_editingBill');
    }
  }, [editingBill]);

  // Load all saved business profiles
  useEffect(() => {
    if (serverStatus === 'online') {
      getAllProfiles()
        .then(setAllProfiles)
        .catch(() => {});
    }
  }, [serverStatus]);

  // Organization branches refresh whenever the switcher opens, so a branch someone
  // else added (a teammate invites you to a second one) appears without a reload.
  useEffect(() => {
    if (!me || serverStatus !== 'online') return;
    let live = true;
    listBusinesses()
      .then((r) => {
        if (live) setBranches(r.data || []);
      })
      .catch(() => {
        /* signed-out or offline: the legacy profile list still works */
      });
    return () => {
      live = false;
    };
  }, [me, serverStatus, showProfileMenu, branchTick]);

  // A branch may not have a local profile yet (created on another device, or a
  // teammate's copy of this business). Its fields already live on the server,
  // so a profile is seeded from them — the logo, payment accounts and invoice
  // history then fill in on this computer as the branch is used.
  const branchMatchesProfile = (branch, bp) =>
    (bp?.gstin && branch?.gstin && bp.gstin.toUpperCase() === branch.gstin.toUpperCase()) ||
    (bp?.businessName || '').trim().toLowerCase() === (branch?.name || '').trim().toLowerCase();

  const profileFromBranch = (branch) => ({
    businessName: branch.name,
    gstin: branch.gstin || '',
    state: branch.state || '',
    address: branch.address || '',
    city: branch.city || '',
    pin: branch.pin || '',
    phone: branch.phone || '',
    email: branch.email || '',
    country: branch.country || 'India',
  });

  // Switching to a branch: use the local profile saved for it when there is
  // one; otherwise create it from the branch. Saving the seed first means the
  // same match rule finds it next time.
  const handleSwitchBranch = async (branch) => {
    setShowProfileMenu(false);
    let list = [];
    try {
      list = (await getAllProfiles()) || [];
    } catch {
      /* profile storage offline: seed anyway */
    }
    const match = list.find((bp) => branchMatchesProfile(branch, bp));
    if (match) {
      await handleSwitchProfile(match);
      return;
    }
    const seed = profileFromBranch(branch);
    try {
      await saveBusinessProfile(seed);
    } catch {
      /* old server down: the account copy is still saved */
    }
    try {
      await saveProfile(seed);
    } catch {
      /* same */
    }
    setAllProfiles(await getAllProfiles().catch(() => list));
    setProfile(seed);
  };

  // Branch created from the Add Branch form: remember it here too and work in
  // it right away, so the user can start invoicing from the new branch.
  const handleBranchCreated = async (branch) => {
    setShowBranchModal(false);
    setBranches((prev) => [...(prev || []), branch]);
    await handleSwitchBranch(branch);
  };

  const canManageBranches = !!me?.permissions?.includes('business:write');

  // A user can belong to several organizations (their own workspace plus any
  // they were invited to). Picking one moves the whole session: the active
  // organization drives which branches and team the rest of the app sees, so
  // the page reloads into it — the same result the account API gives everyone.
  const handleSwitchOrg = async (organizationId) => {
    if (!organizationId || organizationId === me?.organization?.id) return;
    try {
      await switchOrganization(organizationId);
      window.location.reload();
    } catch {
      /* not a member (can't happen — the list came from the server): stay where we are */
    }
  };

  // Branches on the account with no profile saved on this computer. They are
  // still numbered and legal (name/GSTIN/state come from the organization);
  // the extras just start blank.
  const extraBranches = (branches || []).filter(
    (b) => !allProfiles.some((bp) => branchMatchesProfile(b, bp)),
  );

  // Close profile menu on outside click
  useEffect(() => {
    if (!showProfileMenu) return;
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProfileMenu]);

  const handleSwitchProfile = async (bp) => {
    setShowProfileMenu(false);
    const loaded = { ...bp };
    delete loaded.id;
    await saveProfile(loaded);
    setProfile(loaded);
  };

  // v1.10.66 (#64 item 1) — identifies the active business for the screens
  // keyed on it below. GSTIN first, the same rule belongsToProfile() uses to
  // decide which records a business owns; the name covers a business that has
  // no GSTIN yet.
  const businessKey = String(profile?.gstin || profile?.businessName || '')
    .trim()
    .toUpperCase();

  // Print settings belong to the business (change 3.11): load the active business's copy before its screens draw.
  const [printLoadedFor, setPrintLoadedFor] = useState(null);
  useEffect(() => {
    if (!profile) return undefined;
    let live = true;
    loadPrintSettingsFor(businessKey).then(() => {
      if (!live) return;
      setPrintLoadedFor(businessKey);
      const ps = getPrintSettings();
      if (ps.onboardingComplete) setShowWizard(false);
      else if (profile?.businessName) {
        // The business setup after sign-up already asked what the old first-run wizard asks: mark it done, not shown twice.
        savePrintSettings({ ...ps, onboardingComplete: true, onboardingSkipped: false });
        setShowWizard(false);
      } else setShowWizard(!window.location.pathname.startsWith('/accept-invite/'));
    });
    return () => {
      live = false;
    };
  }, [businessKey, profile]);

  // v1.10.66 (#59) — on a phone the sidebar is a slide-in menu. It closes as
  // soon as something in it is chosen, so picking a page never leaves the menu
  // covering the page that was just asked for. Opening the business list is
  // the one exception: that choice is not finished yet.
  const [navOpen, setNavOpen] = useState(false);
  const closeNavAfterPick = (e) => {
    const picked = e.target.closest('button');
    if (picked && !picked.classList.contains('profile-switcher-btn')) setNavOpen(false);
  };

  // v1.10.76 - a fresh editor for every invoice opened, so nothing (such as
  // the stock record of the last invoice) carries over to the next one.
  const [editorKey, setEditorKey] = useState(0);
  // v1.10.77 (#84) - sidebar auto-hide (desktop): a slim strip of icons that
  // opens over the page when pointed at, for more room on small screens.
  const [sidebarAutoHide, setSidebarAutoHide] = useState(() => {
    try {
      return localStorage.getItem('freegstbill_sidebarAutoHide') === '1';
    } catch {
      return false;
    }
  });
  const toggleSidebarAutoHide = (on) => {
    setSidebarAutoHide(on);
    try {
      localStorage.setItem('freegstbill_sidebarAutoHide', on ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  // Where the editor's Back button returns to: the page the document was opened from (a quotation list, say).
  const [backPath, setBackPath] = useState('/invoices');
  // The document type a fresh editor opens with (from the New button of a sales page).
  const [newDocType, setNewDocType] = useState(null);
  const openEditor = () => {
    if (location.pathname !== pathForView('new')) setBackPath(location.pathname);
    setCurrentView('new');
  };
  // `type` is a document type from a sales page; buttons that pass a click event just get a tax invoice.
  const handleNewInvoice = (type) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill(null);
    setNewDocType(typeof type === 'string' ? type : null);
    openEditor();
  };

  const handleEditInvoice = (bill) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill(bill);
    openEditor();
  };

  // v1.10.77 (#86) - Print from the Dashboard row: opens the invoice just long
  // enough to build the same PDF the invoice screen prints (same pages, HD),
  // prints it, and comes back.
  const handlePrintInvoice = (bill) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill({ ...bill, _printOnOpen: true });
    openEditor();
  };

  const handleDuplicateInvoice = (bill) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    const clone = JSON.parse(JSON.stringify(bill));
    clone._isDuplicate = true;
    setEditingBill(clone);
    openEditor();
  };

  const handleInstallPWA = async () => {
    if (!deferredPrompt.current) return;
    deferredPrompt.current.prompt();
    const result = await deferredPrompt.current.userChoice;
    if (result.outcome === 'accepted') {
      setShowInstallBanner(false);
    }
    deferredPrompt.current = null;
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    // Timestamp-based dismissal — the 14-day cool-down in the install-prompt
    // effect uses this to decide whether to re-show. Old boolean key kept for
    // back-compat with v1.6.0 — readers that find only the legacy key treat
    // it as "permanently dismissed" (same as today's behaviour for them).
    localStorage.setItem('freegstbill_pwa_dismissed_at', String(Date.now()));
  };

  // Raise the next document in the sales flow from `bill` (see salesFlow.js). `step` is { to, linkOnly }; with none
  // given it is the old Convert button: a tax invoice. A linkOnly step (a credit note) leaves `bill` open.
  const handleConvertToInvoice = (bill, step) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    const clone = JSON.parse(JSON.stringify(bill));
    clone._isDuplicate = true;
    clone._convertToType = step?.to || 'tax-invoice';
    if (step?.linkOnly) clone._linkOnly = true;
    setEditingBill(clone);
    openEditor();
  };

  // Pull the user's module preferences once per render. Re-mount happens
  // when settings save, which triggers a re-render via the profile state.
  const enabledModules = getEnabledModules();
  const showIfModule = (moduleId) => isModuleEnabled(moduleId, enabledModules);

  // If the user just disabled the module backing the current view, kick them to dashboard
  // so they don't land on an empty page after toggling.
  useEffect(() => {
    const map = {
      new: 'invoicing',
      sales: 'invoicing',
      'sales-quotes': 'invoicing',
      'sales-orders': 'invoicing',
      'sales-challans': 'invoicing',
      'sales-invoices': 'invoicing',
      'sales-proforma': 'invoicing',
      'sales-credit': 'invoicing',
      clients: 'clients',
      inventory: 'inventory',
      expenses: 'expenses',
      purchases: 'purchases',
      'payment-out': 'purchases',
      'purchase-orders': 'purchases',
      'purchase-returns': 'purchases',
      'other-income': 'expenses',
      recurring: 'recurring',
      receipts: 'receipts',
      reports: 'reports',
      filing: 'gstReturns',
    };
    const moduleForView = map[currentView];
    if (moduleForView && !isModuleEnabled(moduleForView, enabledModules)) {
      setCurrentView('dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, JSON.stringify(enabledModules)]);

  // The classic menu; the new shell's comes from app/navigation.ts (NAV), filtered by role and modules.
  // A CA in at least one client organization gets the CA Dashboard, whichever organization is open.
  const isCa = !!me?.organizations?.some((o) => o.role === 'ca');
  const navItems = buildClassicNav({ showIfModule, openDocs, isCa });
  const vyNav = useMemo(
    () => (vyapar ? visibleNav(NAV, { can: (p) => (me ? can(p) : true), moduleOn: showIfModule, isCa }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vyapar, me, JSON.stringify(enabledModules)],
  );
  const [vyDrawer, setVyDrawer] = useState(false);
  const [vyRail, setVyRail] = useState(() => {
    try {
      return localStorage.getItem('ledgora_nav.rail') === '1';
    } catch {
      return false;
    }
  });
  const toggleVyRail = () =>
    setVyRail((v) => {
      try {
        localStorage.setItem('ledgora_nav.rail', v ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !v;
    });

  // The editor belongs to the sales page of the document in it, so that menu entry stays lit while you work.
  const editorType = editingBill?._convertToType || editingBill?.invoiceType || newDocType || 'tax-invoice';
  const activeNavId = currentView === 'new' ? salesPageForType(editorType)?.id || 'sales' : currentView;
  // The top bar's New button follows the page: "New quotation" on the quotations page, and so on.
  const pageHere = salesPageForView(currentView);
  const topbarNew = pageHere ? { type: pageHere.newType, label: `New ${pageHere.singular.toLowerCase()}` } : { type: null, label: 'New invoice' };

  // Command palette actions — declared here (not earlier) because the deps
  // array references `navItems` and `handleNewInvoice`, which are consts.
  // Reading a const before its declaration triggers a Temporal Dead Zone
  // ReferenceError ("Cannot access 'X' before initialization") at runtime.
  const paletteActions = useMemo(
    () => buildPaletteActions({ navItems, handleNewInvoice, handleEditInvoice, setCurrentView, toggleDark, setShowShortcutsHelp, searchCorpus }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navItems, handleNewInvoice, searchCorpus],
  );

  const filteredPalette = paletteActions.filter(
    (a) => !paletteQuery.trim() || a.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );
  // Open Anything: every screen of the new menu by its breadcrumb, then the palette's actions and records (its
  // "Go to" entries are the classic menu's, so they are left out).
  const openAnythingActions = useMemo(() => {
    if (!vyapar) return [];
    const screens = navScreens(vyNav).map(({ leaf, crumb }) => ({
      label: crumb,
      hint: '',
      category: 'nav',
      run: () => (leaf.href ? window.open(leaf.href, '_blank', 'noopener,noreferrer') : navigate(leafPath(leaf))),
    }));
    const rest = paletteActions.filter((a) => a.category !== 'nav');
    rest.push({ label: 'Use the classic layout', hint: '', category: 'action', run: () => setUiMode('classic') });
    return [...screens, ...rest];
  }, [vyapar, vyNav, paletteActions, navigate]);

  // Global keyboard shortcuts. Lives down here for the same TDZ reason —
  // the handler closes over `handleNewInvoice` which is declared above only.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setShowPalette((p) => !p);
        setPaletteQuery('');
        setPaletteIdx(0);
      } else if (e.key === '/') {
        e.preventDefault();
        setShowShortcutsHelp((s) => !s);
      } else if ((e.key === 'n' || e.key === 'N') && !editable) {
        e.preventDefault();
        handleNewInvoice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The new shell's keys (Vyapar parity P0-S2): Ctrl+F Open Anything, Alt+N the page's New, Alt+B the menu rail,
  // ? the shortcut list. Read through a ref so the handler always sees this render's New button.
  const vyKeys = useRef({});
  useEffect(() => {
    vyKeys.current = { onNew: () => handleNewInvoice(topbarNew.type), canNew: can('invoice:write') };
  });
  useEffect(() => {
    if (!vyapar) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setShowPalette(true);
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') {
        e.preventDefault();
        if (vyKeys.current.canNew) vyKeys.current.onNew();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB') {
        e.preventDefault();
        toggleVyRail();
      } else if (e.key === '?' && !editable && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowShortcutsHelp((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vyapar]);

  // v1.9.4 — Accessibility hooks (v1.10.4/1.10.6 updated):
  //   1. Mirror `title` → `aria-label` on every icon button that lacks one.
  //      Runs on mount + via a MutationObserver when the DOM adds new
  //      icon buttons (bulk toolbars, modals, etc.). See M15.
  //   2. Global ESC handler for any open `.modal-overlay` — clicks the
  //      backdrop (which triggers the overlay's own close). No CSS
  //      class is added; the earlier `.esc-closable` idea was never
  //      implemented, comment cleaned up (audit L7).
  useEffect(() => {
    // v1.10.4 — audit M15. Prior code polled the DOM every 3 seconds
    // to mirror title→aria-label on new .icon-btn elements. Constant
    // idle-time work for a paper-thin accessibility win. Replaced with
    // a MutationObserver that fires ONLY when new buttons enter the
    // DOM. Existing buttons get the treatment once at mount.
    const mirrorTitleToAria = (root = document) => {
      root.querySelectorAll('button.icon-btn[title]:not([aria-label])').forEach((btn) => {
        btn.setAttribute('aria-label', btn.getAttribute('title'));
      });
    };
    mirrorTitleToAria();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              // Element
              if (node.matches?.('button.icon-btn[title]:not([aria-label])')) {
                node.setAttribute('aria-label', node.getAttribute('title'));
              }
              mirrorTitleToAria(node);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Global ESC → click the topmost modal-overlay (dismisses it).
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
      const top = overlays[overlays.length - 1];
      if (!top) return;
      if (showPalette) return;
      top.click();
    };
    window.addEventListener('keydown', onEsc);
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', onEsc);
    };
  }, [showPalette]);

  if (serverDown && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    // The hosted app: the data lives on the server, nothing needs starting. This is a connection or a restart, so say so
    // and let the person try again at once instead of waiting for the next check.
    return (
      <div className="server-down-overlay">
        <div className="server-down-modal" role="alert">
          <FileText size={48} color="#16a34a" />
          <h2>We can’t reach the server</h2>
          <p>
            Your data is stored safely on the server, so nothing is lost. Check your internet connection; if it is fine, the
            service is restarting and will be back in a moment.
          </p>
          <div className="server-down-waiting">
            <div className="server-down-spinner" />
            <span>Trying again automatically…</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Try now
          </button>
        </div>
      </div>
    );
  }

  if (serverDown) {
    return (
      <div className="server-down-overlay">
        <div className="server-down-modal">
          <FileText size={48} color="#16a34a" />
          <h2>Free GST Billing Software Needs a Quick Start</h2>
          <p>
            Your data is <strong>100% safe</strong> on your computer — nothing is lost. The app just
            needs to be started once.
          </p>
          {/* v1.10.69 - there was an "Open GST Billing" button here, linking to
              freegstbill://start. Only the old Install FreeGSTBill.bat ever
              registered that protocol, and it stopped shipping in v1.10.44, so
              on every current install the button did nothing at all. There is
              also nothing it could do: a web page cannot start a program, and
              this screen is being served from the offline cache precisely
              because the server is not running. The steps below are the only
              real answer, so they are no longer the fallback. See ERR-019. */}
          <div className="server-down-steps">
            <p className="server-down-hint">How to start it:</p>
            <ol>
              <li>
                Double-click <strong>Free GST Billing</strong> on your Desktop, then click{' '}
                <strong>Open App</strong>
              </li>
              <li>
                Or search <strong>"Free GST Billing"</strong> in the Start Menu
              </li>
            </ol>
          </div>
          <p className="server-down-safe">
            All your invoices, clients, and data are safely stored on your computer. They are never
            deleted or shared.
          </p>
          <div className="server-down-waiting">
            <div className="server-down-spinner" />
            <span>Starting... this page will open automatically.</span>
          </div>
        </div>
      </div>
    );
  }

  if (showWelcome) {
    return (
      <>
        <WelcomeGuide
          onComplete={(p) => {
            if (p) setProfile(p);
            setShowWelcome(false);
          }}
        />
        <ToastContainer />
        <ConfirmModalContainer />
      </>
    );
  }

  // v1.10.33 — "Finish setup" bottom-right pill. Shown when the user
  // hit Skip on the wizard (onboardingSkipped=true) so they can come
  // back later without hunting through Settings. Hidden after they
  // finish setup (finish() clears the flag) or if they explicitly said
  // "None of these — I'll configure manually".
  const showResumeSetupPill = (() => {
    try {
      const ps = getPrintSettings();
      return !showWizard && ps.onboardingComplete === true && ps.onboardingSkipped === true;
    } catch {
      return false;
    }
  })();

  // v1.10.81 — The pill used to fix itself at bottom-right on its own; the
  // new-version reload button lives in the same corner, so both now share
  // ONE fixed stack (pill above button) that lifts above the docked Save bar
  // on Settings — the two can never overlap, and each other's variable width
  // ("✨ Finish setup" / "New version — reload") never changes the anchor.
  const resumePill = showResumeSetupPill && (
    <button
      type="button"
      onClick={() => setShowWizard(true)}
      title="Come back to the setup wizard — pick a business type, paper size, and language."
      style={{
        padding: '0.6rem 1rem',
        borderRadius: 999,
        background: 'var(--primary)',
        color: '#fff',
        border: 'none',
        fontSize: '0.85rem',
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(30,64,175,0.35), 0 2px 4px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        whiteSpace: 'nowrap',
      }}
    >
      ✨ Finish setup
    </button>
  );
  const updateCorner = (
    <div
      style={{
        position: 'fixed',
        // Above the docked Save bar on Settings, so it never covers Save.
        bottom: currentView.startsWith('settings') ? '5.5rem' : '1.25rem',
        right: '1.25rem',
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '0.6rem',
      }}
    >
      {resumePill}
      <UpdateReloadButton />
    </div>
  );

  // The screens, drawn inside whichever shell is on.
  const screens = (
    <>
        {/* v1.10.4 — All lazy views under one Suspense boundary. Only the matched view's chunk actually loads.
             `key={businessKey}` remounts the screens that read the business once when they open, so a business
             switch never leaves the previous company's records on screen (v1.10.66, #64 item 1). */}
        <Suspense fallback={<ViewLoading />}>
          {printLoadedFor !== businessKey ? (
            <ViewLoading />
          ) : (
            <ScreenBoundary resetKey={location.pathname}>
              <FeatureGuard>
              <Routes>
                <Route
                  path="/"
                  element={
                    <AnalyticsDashboard
                      onNew={handleNewInvoice}
                      onEdit={handleEditInvoice}
                      onOpenProducts={() => setCurrentView('inventory')}
                      onOpenSettings={() => setCurrentView('settings')}
                      activeProfile={profile}
                    />
                  }
                />
                <Route
                  path="/invoices"
                  element={
                    <Dashboard
                      mode="invoices"
                      onNew={handleNewInvoice}
                      onEdit={handleEditInvoice}
                      onPrint={handlePrintInvoice}
                      onDuplicate={handleDuplicateInvoice}
                      onConvert={handleConvertToInvoice}
                      onOpenProducts={() => setCurrentView('inventory')}
                      onOpenSettings={() => setCurrentView('settings')}
                      onOpenGuide={openDocs}
                      activeProfile={profile}
                    />
                  }
                />
                <Route
                  path="/sales"
                  element={
                    <SalesOverview
                      activeProfile={profile}
                      onNew={handleNewInvoice}
                      onConvert={handleConvertToInvoice}
                      go={setCurrentView}
                    />
                  }
                />
                {SALES_PAGES.map((page) => (
                  <Route
                    key={page.id}
                    path={page.path}
                    element={
                      <Dashboard
                        key={page.id}
                        mode="invoices"
                        scope={page}
                        onNew={handleNewInvoice}
                        onEdit={handleEditInvoice}
                        onPrint={handlePrintInvoice}
                        onDuplicate={handleDuplicateInvoice}
                        onConvert={handleConvertToInvoice}
                        onOpenProducts={() => setCurrentView('inventory')}
                        onOpenSettings={() => setCurrentView('settings')}
                        onOpenGuide={openDocs}
                        activeProfile={profile}
                      />
                    }
                  />
                ))}
                <Route
                  path="/invoices/new"
                  element={
                    <InvoiceGenerator
                      key={editorKey}
                      onBack={() => {
                        setEditingBill(null);
                        navigate(backPath);
                      }}
                      profile={profile}
                      editingBill={editingBill}
                      initialType={newDocType}
                    />
                  }
                />
                {pathsForView('clients').map((path) => (
                  <Route
                    key={path}
                    path={path}
                    element={
                      <ClientsView
                        onNew={handleNewInvoice}
                        onEdit={handleEditInvoice}
                        onDuplicate={handleDuplicateInvoice}
                      />
                    }
                  />
                ))}
                <Route path="/products" element={<InventoryView />} />
                <Route path="/expenses" element={<ExpenseTracker key={businessKey} />} />
                <Route path="/purchases" element={<PurchaseBills key={businessKey} />} />
                <Route path={pathForView('payment-out')} element={<PaymentVoucher direction="out" key={businessKey} />} />
                <Route path={pathForView('purchase-orders')} element={<PurchaseOrders key={businessKey} />} />
                <Route path={pathForView('purchase-returns')} element={<DebitNotes key={businessKey} />} />
                <Route path="/accounting" element={<Navigate to="/accounting/setup" replace />} />
                <Route path="/accounting/:tab" element={<AccountingPage key={businessKey} />} />
                <Route path={pathForView('barcode')} element={<BarcodePage key={businessKey} />} />
                <Route path={pathForView('tally')} element={<TallyPage key={businessKey} />} />
                <Route path={pathForView('close-fy')} element={<CloseFyPage key={businessKey} />} />
                <Route path={pathForView('backup')} element={<BackupPage key={businessKey} />} />
                <Route path={pathForView('setup')} element={<SetupPage key={businessKey} />} />
                <Route path={pathForView('trash')} element={<TrashPage key={businessKey} />} />
                <Route path="/pos" element={<PosPage key={businessKey} />} />
                <Route path="/cash-bank" element={<Navigate to="/cash-bank/accounts" replace />} />
                <Route path="/cash-bank/:tab" element={<CashBankPage key={businessKey} />} />
                <Route path={pathForView('verify')} element={<AccountingPage key={`${businessKey}-verify`} initialTab="verify" />} />
                <Route path={pathForView('other-income')} element={<ExpenseTracker kind="income" key={`${businessKey}-income`} />} />
                <Route
                  path="/recurring"
                  element={<RecurringInvoices key={businessKey} onEdit={handleEditInvoice} />}
                />
                {pathsForView('receipts').map((path) => (
                  <Route key={path} path={path} element={<ReceiptVoucher key={businessKey} />} />
                ))}
                {FEATURES.saleInlinePayments && (
                  <Route path={pathForView('salesman')} element={<SalesmenView key={businessKey} />} />
                )}
                <Route path={pathForView('reminders')} element={<RemindersPage key={businessKey} />} />
                <Route path={pathForView('returns')} element={<ReturnRegister key={businessKey} />} />
                <Route path="/filing/:id" element={<FilingPackPage key={businessKey} />} />
                <Route path={pathForView('practice')} element={<PracticePage />} />
                <Route path={pathForView('itr4')} element={<Itr4Page key={businessKey} />} />
                <Route path={pathForView('itr3')} element={<Itr3Page key={businessKey} />} />
                <Route path={pathForView('assets')} element={<AssetsPage key={businessKey} />} />
                <Route path={pathForView('edit-log')} element={<EditLogPage key={businessKey} />} />
                <Route path="/practice" element={<Navigate to={pathForView('practice')} replace />} />
                <Route path={pathForView('catalog')} element={<CatalogSettingsPage key={businessKey} />} />
                <Route path="/reports" element={<ReportsHub key={businessKey} />} />
                <Route path="/reports/classic" element={<ReportsView key={businessKey} />} />
                <Route path="/reports/cash-bank/:reportId" element={<CashBankReportRedirect />} />
                <Route path="/reports/:reportId" element={<ReportPage key={businessKey} />} />
                <Route path="/gst-returns" element={<Navigate to="/gst-returns/gstr1" replace />} />
                <Route path="/gst-returns/:tab" element={<GstReturnsPage key={businessKey} />} />
                <Route
                  path="/income-tax"
                  element={
                    hasFeature('income-tax') ? (
                      <IncomeTax key={businessKey} />
                    ) : (
                      <LockedFeature name="Income tax" feature="income-tax" />
                    )
                  }
                />
                <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                {SETTINGS_TABS.map(({ id }) => (
                  <Route
                    key={id}
                    path={`/settings/${id}`}
                    element={
                      <SettingsLayout>
                        <SettingsTabPage tab={id} key={businessKey} />
                      </SettingsLayout>
                    }
                  />
                ))}
                {['business', 'documents', 'features', 'data'].map((tab) => (
                  <Route
                    key={tab}
                    path={`/settings/${tab}`}
                    element={
                      <SettingsLayout>
                        <SettingsView
                          tab={tab}
                          onSaved={(p) => setProfile(p)}
                          me={me}
                          branches={branches}
                          canManageBranches={canManageBranches}
                          onAddBranch={() => setShowBranchModal(true)}
                        />
                      </SettingsLayout>
                    }
                  />
                ))}
                <Route
                  path="/settings/team"
                  element={
                    <SettingsLayout>
                      <TeamPage />
                    </SettingsLayout>
                  }
                />
                <Route
                  path="/settings/roles"
                  element={
                    <SettingsLayout>
                      <RolesPage />
                    </SettingsLayout>
                  }
                />
                <Route
                  path="/settings/billing"
                  element={
                    <SettingsLayout>
                      <BillingPage />
                    </SettingsLayout>
                  }
                />
                <Route
                  path="/settings/security"
                  element={
                    <SettingsLayout>
                      <SecurityPage />
                    </SettingsLayout>
                  }
                />
                <Route path="/accept-invite/:id" element={<AcceptInvitePage />} />
                {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
                  <Route key={from} path={from} element={<Navigate to={to} replace />} />
                ))}
                {UiGallery && <Route path="/dev/ui" element={<UiGallery />} />}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </FeatureGuard>
            </ScreenBoundary>
          )}
        </Suspense>
    </>
  );

  // Vyapar parity P0-S2: where the current page sits in the new menu (lit entry, breadcrumb).
  const vyHere = vyapar ? findNavEntry(vyNav, location.pathname, activeNavId) : null;
  const vyGo = (path) => navigate(path);
  const saveBusinessName = async (businessName) => {
    const next = { ...(profile || {}), businessName };
    try {
      await saveProfile(next);
      setProfile(next);
      toast('Business name saved', 'success');
    } catch {
      toast('Could not save the business name. Try again from Settings.', 'error');
    }
  };

  const overlays = (
    <>
      {showNotifs && (
        <NotificationPopover
          notifications={notifications}
          isLive={isLive}
          notifTotal={notifTotal}
          dismissableCount={dismissableCount}
          onMarkAll={markAllNotifsRead}
          onClose={() => setShowNotifs(false)}
          go={setCurrentView}
        />
      )}

      {vyapar ? (
        <OpenAnything
          open={showPalette}
          onQueryChange={setOpenAnythingQuery}
          onClose={() => setShowPalette(false)}
          actions={openAnythingActions}
          onShowShortcuts={() => {
            setShowPalette(false);
            setShowShortcutsHelp(true);
          }}
        />
      ) : (
        <CommandPalette
          open={showPalette}
          query={paletteQuery}
          onQuery={(q) => {
            setPaletteQuery(q);
            setPaletteIdx(0);
          }}
          actions={filteredPalette}
          index={paletteIdx}
          onIndex={setPaletteIdx}
          onClose={() => setShowPalette(false)}
          onShowShortcuts={() => {
            setShowPalette(false);
            setShowShortcutsHelp(true);
          }}
        />
      )}

      <ShortcutsHelp open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} vyapar={vyapar} />

      {/* Add a branch (organization accounts) — created on the account server,
          then switched into so the user is invoicing from it immediately. */}
      {showBranchModal && (
        <BranchModal onClose={() => setShowBranchModal(false)} onCreated={handleBranchCreated} />
      )}

      <ToastContainer />
      <ConfirmModalContainer />
    </>
  );

  const installBanner = showInstallBanner && (
    <div className="pwa-install-banner">
      <Download size={18} />
      <span>
        <strong>Install as Desktop App</strong> — own icon, no browser, opens instantly.
        Right-click the icon for quick-jump to New Invoice / GST Returns.
      </span>
      <button className="pwa-install-btn" onClick={handleInstallPWA}>
        Install App
      </button>
      <button
        className="pwa-dismiss-btn"
        onClick={dismissInstallBanner}
        title="Remind me later (re-shows in 14 days)"
      >
        <X size={16} />
      </button>
    </div>
  );

  if (vyapar) {
    return (
      <AppShell vyapar rail={vyRail}>
        {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
        {updateCorner}
        <VySidebar
          nav={vyNav}
          activeId={vyHere?.leaf.id}
          onGo={vyGo}
          badges={{ parties: isLive('overdue') ? notifications.overdue.length : 0 }}
          rail={vyRail}
          onToggleRail={toggleVyRail}
          onOpenAnything={() => setShowPalette(true)}
          drawerOpen={vyDrawer}
          onCloseDrawer={() => setVyDrawer(false)}
          footer={
            <CompanySwitcher
              profile={profile}
              allProfiles={allProfiles}
              extraBranches={extraBranches}
              handleSwitchProfile={handleSwitchProfile}
              handleSwitchBranch={handleSwitchBranch}
              canManageBranches={canManageBranches}
              onAddBranch={() => setShowBranchModal(true)}
              onManage={() => setCurrentView('settings')}
              onOpen={() => setBranchTick((t) => t + 1)}
            />
          }
        />
        <div className="vy-main">
          {installBanner}
          <VyTopBar
            profile={profile}
            crumb={vyHere ? { group: vyHere.group?.label ?? null, label: vyHere.leaf.label } : null}
            me={me}
            onSaveBusinessName={saveBusinessName}
            onEditBusiness={() => navigate('/settings/business')}
            onSetup={() => (profile?.businessName ? navigate('/settings/business') : setShowWizard(true))}
            onNew={() => handleNewInvoice(topbarNew.type)}
            newLabel={topbarNew.label}
            canWrite={can('invoice:write')}
            notifTotal={notifTotal}
            onBell={() => setShowNotifs((v) => !v)}
            onGo={vyGo}
            canTeam={can('team:read')}
            darkMode={darkMode}
            toggleDark={toggleDark}
            serverStatus={serverStatus}
            onSwitchOrg={handleSwitchOrg}
            signOut={signOut}
            onClassic={() => setUiMode('classic')}
            onOpenMenu={() => setVyDrawer(true)}
          />
          <div className="main-content">
            <PlanBanner />
            {screens}
            {currentView === 'dashboard' && <AppFooter />}
          </div>
        </div>
        {overlays}
      </AppShell>
    );
  }

  return (
    <AppShell autoHideSidebar={sidebarAutoHide}>
      {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
      {updateCorner}
      <Sidebar
        me={me}
        signOut={signOut}
        handleSwitchOrg={handleSwitchOrg}
        profile={profile}
        navItems={navItems}
        currentView={activeNavId}
        setCurrentView={setCurrentView}
        can={can}
        notifTotal={notifTotal}
        setShowNotifs={setShowNotifs}
        darkMode={darkMode}
        toggleDark={toggleDark}
        serverStatus={serverStatus}
        sidebarAutoHide={sidebarAutoHide}
        toggleSidebarAutoHide={toggleSidebarAutoHide}
        navOpen={navOpen}
        setNavOpen={setNavOpen}
        closeNavAfterPick={closeNavAfterPick}
      />

      {installBanner}
      <div className="main-content">
            <PlanBanner />
        <TopBar
          profile={profile}
          allProfiles={allProfiles}
          extraBranches={extraBranches}
          showProfileMenu={showProfileMenu}
          setShowProfileMenu={setShowProfileMenu}
          profileMenuRef={profileMenuRef}
          handleSwitchProfile={handleSwitchProfile}
          handleSwitchBranch={handleSwitchBranch}
          canManageBranches={canManageBranches}
          setShowBranchModal={setShowBranchModal}
          setCurrentView={setCurrentView}
          onNewInvoice={() => handleNewInvoice(topbarNew.type)}
          newLabel={topbarNew.label}
          onOpenPalette={() => setShowPalette(true)}
          canWrite={can('invoice:write')}
        />
        {screens}
        {/* Version + ledgora line: Dashboard only, so it never takes space on working screens. */}
        {currentView === 'dashboard' && <AppFooter />}
      </div>

      {overlays}
    </AppShell>
  );
}

export default App;
