import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import {
  Home,
  FileText,
  Settings,
  Plus,
  Users,
  Package,
  BarChart3,
  Wallet,
  RefreshCw,
  Receipt,
  BookOpen,
  Moon,
  Sun,
  Download,
  X,
  ShoppingCart,
  ChevronDown,
  Building2,
  Pencil,
  HelpCircle,
  Search,
  Command,
  Bell,
  Calculator,
  HardDrive,
  Menu,
  Heart,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import {
  getAllProfiles,
  saveProfile,
  saveBusinessProfile,
  getEnabledModules,
  getAllBills,
  getAllProducts,
  getStockAlertSettings,
  getAllClients,
} from './lib/data';
import {
  isModuleEnabled,
  getUpcomingFilings,
  countsAsSales,
  localToday,
  toLocalIsoDate,
  DOCS_URL,
} from './utils';
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
import InvoiceGenerator from './features/invoices/editor/InvoiceEditorPage';
import SetupWizard from './features/onboarding/SetupWizard';
import BranchModal from './features/settings/BranchModal';
import { useSession } from './features/auth/SessionContext';
import ToastContainer from './components/ui/Toast';
import { useTheme } from './app/providers';
import NotificationPopover from './app/NotificationBell';
import Sidebar from './app/Sidebar';
import TopBar from './app/TopBar';
import AppShell from './app/AppShell';
import CommandPalette from './app/CommandPalette';
import ShortcutsHelp from './app/ShortcutsHelp';
import { viewFromPath, pathForView, legacyViewRedirect } from './app/router';
import { useEntitlements } from './features/billing/useEntitlements';
import LockedFeature from './components/ui/LockedFeature';
import { LoadingState } from './components/ui/States';
import ScreenBoundary from './app/ScreenBoundary';
import ConfirmModalContainer from './components/ui/ConfirmModal';
import WelcomeGuide from './features/onboarding/WelcomeGuide';
function GstReturnsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const valid = ['gstr1', 'gstr3b', 'gstr2b', 'tds', 'guide'];
  if (!valid.includes(tab)) return <Navigate to="/gst-returns/gstr1" replace />;
  return <GSTReturns tab={tab} onTab={(t) => navigate(`/gst-returns/${t}`)} />;
}

const SettingsView = lazy(() => import('./features/settings/SettingsView'));
const SettingsLayout = lazy(() => import('./features/settings/SettingsLayout'));
const TeamPage = lazy(() => import('./features/settings/team/TeamPage'));
const SecurityPage = lazy(() => import('./features/settings/security/SecurityPage'));
const AcceptInvitePage = lazy(() => import('./features/auth/AcceptInvitePage'));
const ClientsView = lazy(() => import('./features/parties/ClientsView'));
const InventoryView = lazy(() => import('./features/items/InventoryView'));
const ReportsView = lazy(() => import('./features/reports/ReportsView'));
const ExpenseTracker = lazy(() => import('./features/expenses/ExpenseTracker'));
const RecurringInvoices = lazy(() => import('./features/recurring/RecurringInvoices'));
const ReceiptVoucher = lazy(() => import('./features/payments/ReceiptVoucher'));
const GSTReturns = lazy(() => import('./features/gst-returns/GSTReturns'));
const IncomeTax = lazy(() => import('./features/income-tax/IncomeTax'));
const PurchaseBills = lazy(() => import('./features/purchases/PurchaseBills'));
import AppFooter from './app/AppFooter';
import { getPrintSettings, loadPrintSettingsFor } from './features/print/printSettingsStore';

const openDocs = () => window.open(DOCS_URL, '_blank', 'noopener,noreferrer');

// v1.10.4 — Lightweight Suspense fallback shown while a lazy view
// downloads. Purely visual — no data fetching, no state.
const ViewLoading = LoadingState;

function App() {
  const { me, signOut } = useSession();
  // v1.9.3 — Setup Wizard shown on first-run (before onboardingComplete = true)
  // Decided once this business's print settings have loaded (see printLoadedFor below).
  const [showWizard, setShowWizard] = useState(false);
  // The screen comes from the URL (change 3.1), so refresh, back/forward and copied links land where they should.
  const location = useLocation();
  const navigate = useNavigate();
  const currentView = viewFromPath(location.pathname);
  const setCurrentView = useCallback((id) => navigate(pathForView(id)), [navigate]);
  const { can, hasFeature } = useEntitlements();
  // Old PWA shortcuts and bookmarks used /?view=new.
  useEffect(() => {
    const target = legacyViewRedirect(location.pathname, location.search);
    if (target) navigate(target, { replace: true });
  }, [location.pathname, location.search, navigate]);
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
  const [showBranchModal, setShowBranchModal] = useState(false);

  // ---- Notification centre ----
  // Computed from server data on app boot + every 10 minutes; tucked under a
  // bell icon next to dark-mode toggle in the sidebar. Each section is one
  // click away from the relevant page.
  const [notifications, setNotifications] = useState({
    overdue: [],
    dueSoon: [],
    lowStock: [],
    filings: [],
    autoFire: null,
  });
  const [showNotifs, setShowNotifs] = useState(false);

  // v1.10.62 — reported (#53, @sangwanmail-eng): "Notifications should clear
  // after check."
  //
  // They never did, and the reason is that these are not messages — they are
  // computed live from your data every time the app loads ("3 invoices are
  // overdue", "2 products are low on stock"). There was no notion of having
  // read one, so the badge simply reported what was true and stayed lit
  // forever.
  //
  // Marking them read cannot just hide them, though: if an invoice goes
  // overdue tomorrow you must be told, even if you dismissed yesterday's
  // overdue notice. So dismissal is recorded per section as a SIGNATURE of
  // what was actually shown — the specific invoice numbers, the specific
  // products. Dismissing stores that signature; the section stays quiet only
  // while the signature is unchanged. The moment the underlying facts differ
  // — a new overdue invoice, a different product running low — the signature
  // changes and the alert comes back on its own.
  //
  // Kept in localStorage: it is a per-machine reading preference, not
  // business data, and it must not travel in a backup or sync to another PC.
  const DISMISS_KEY = 'fgsb_dismissedNotifs';
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const notifSignatures = useMemo(
    () => ({
      overdue: notifications.overdue
        .map((b) => b.invoiceNumber || b.id)
        .sort()
        .join('|'),
      dueSoon: notifications.dueSoon
        .map((b) => b.invoiceNumber || b.id)
        .sort()
        .join('|'),
      lowStock: notifications.lowStock
        .map((p) => `${p.id || p.name}:${p.stock ?? ''}`)
        .sort()
        .join('|'),
      filings: notifications.filings
        .map((f) => f.label || f.id || String(f))
        .sort()
        .join('|'),
      autoFire: notifications.autoFire?.count > 0 ? `autofire:${notifications.autoFire.count}` : '',
    }),
    [notifications],
  );

  // A section counts toward the badge only when it has content AND that
  // content is not the exact thing the user already dismissed.
  const isLive = (key) => !!notifSignatures[key] && dismissed[key] !== notifSignatures[key];

  const notifTotal =
    (isLive('overdue') ? notifications.overdue.length : 0) +
    (isLive('dueSoon') ? notifications.dueSoon.length : 0) +
    (isLive('lowStock') ? notifications.lowStock.length : 0) +
    (isLive('filings') ? notifications.filings.length : 0) +
    (isLive('autoFire') ? 1 : 0);

  // How many sections are currently showing something that could be cleared.
  const dismissableCount = ['overdue', 'dueSoon', 'lowStock', 'filings', 'autoFire'].filter(
    isLive,
  ).length;

  const markAllNotifsRead = () => {
    const next = { ...dismissed, ...notifSignatures };
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      try {
        const [bills, products, stockAlertCfg] = await Promise.all([
          getAllBills().catch(() => []),
          getAllProducts().catch(() => []),
          getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
        ]);
        if (cancelled) return;
        // Local dates: toISOString() is UTC (yesterday in India until 05:30),
        // while the server stamps lastRecurringAutoFire with its local date.
        const today = localToday();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 3);
        const tomorrowStr = toLocalIsoDate(tomorrow);
        // v1.10.67 (#66 item 12) — never chase payment for a cancelled invoice;
        // nor for a quotation, proforma, challan or credit note (countsAsSales).
        const overdue = bills.filter((b) => {
          const d = b.data?.details?.dueDate;
          return d && d < today && b.status !== 'paid' && countsAsSales(b);
        });
        const dueSoon = bills.filter((b) => {
          const d = b.data?.details?.dueDate;
          return d && d >= today && d <= tomorrowStr && b.status !== 'paid' && countsAsSales(b);
        });
        // Honour the user's stock-alert preferences. When disabled, the filter
        // returns nothing — bell badge drops to 0 for the stock category.
        // When enabled, use the configured threshold (default 5).
        const stockThreshold = Number(stockAlertCfg?.threshold ?? 5);
        const lowStock =
          stockAlertCfg?.enabled === false
            ? []
            : products.filter((p) => (p.stock ?? 999) <= stockThreshold);
        const filings = getUpcomingFilings().filter((f) => f.daysAway <= 10);
        // Recurring auto-fire breadcrumb — set by server.js processDueRecurring().
        // Only "fresh" (today's) auto-fires count as a notification; older ones
        // would otherwise stay sticky forever.
        let autoFire = null;
        try {
          const r = await fetch('/v1/workspace/meta/lastRecurringAutoFire');
          if (r.ok) {
            const j = await r.json();
            if (j.value && j.value.date === today && j.value.count > 0) autoFire = j.value;
          }
        } catch {
          /* fine */
        }
        setNotifications({ overdue, dueSoon, lowStock, filings, autoFire });
      } catch {
        /* offline / server down — leave previous counts */
      }
    };
    compute();
    const interval = setInterval(compute, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentView]); // recompute on view change so the bell stays fresh after the user records a payment

  // ---- Keyboard shortcuts + command palette ----
  // Ctrl+K opens a Spotlight-style command palette; Ctrl+N starts a new
  // invoice from anywhere; Ctrl+/ shows the full shortcuts list. Ctrl+S /
  // Ctrl+P live in InvoiceGenerator (they need invoice-form context). All
  // global handlers also accept Meta (⌘) for macOS users.
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  // v1.9.4 — pre-load searchable content so Ctrl+K acts as a true global
  // search across invoices, clients, products, and settings sections.
  // Small cost (fires once on mount + when palette opens); big UX win.
  const [searchCorpus, setSearchCorpus] = useState({ bills: [], clients: [], products: [] });
  useEffect(() => {
    Promise.all([
      getAllBills().catch(() => []),
      getAllClients().catch(() => []),
      getAllProducts().catch(() => []),
    ]).then(([bills, clients, products]) => {
      setSearchCorpus({
        bills: bills.slice(0, 100),
        clients: clients.slice(0, 200),
        products: products.slice(0, 200),
      });
    });
  }, [showPalette]); // refresh when palette opens
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

    const checkServer = async () => {
      try {
        const res = await fetch('/v1/workspace/profile', { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          if (cancelled) return;
          misses = 0;
          setServerDown(false);
          setServerStatus('online');
          if (!profileLoaded.current) {
            profileLoaded.current = true;
            const p = await res.json();
            setProfile(p);
            if (!p.businessName && !localStorage.getItem('freegstbill_onboarded')) {
              setShowWelcome(true);
            }
          }
          return;
        }
        throw new Error('not ok');
      } catch {
        if (cancelled) return;
        misses += 1;
        if (!profileLoaded.current || misses >= 3) {
          setServerDown(true);
          setServerStatus('offline');
        }
      }
    };

    checkServer();
    // Keep checking every 5 seconds (fast when down, normal heartbeat when up)
    retryTimer.current = setInterval(checkServer, 5000);

    return () => {
      cancelled = true;
      if (retryTimer.current) clearInterval(retryTimer.current);
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
  }, [me, serverStatus, showProfileMenu]);

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
      setShowWizard(!getPrintSettings().onboardingComplete);
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
  const handleNewInvoice = () => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill(null);
    setCurrentView('new');
  };

  const handleEditInvoice = (bill) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill(bill);
    setCurrentView('new');
  };

  // v1.10.77 (#86) - Print from the Dashboard row: opens the invoice just long
  // enough to build the same PDF the invoice screen prints (same pages, HD),
  // prints it, and comes back.
  const handlePrintInvoice = (bill) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    setEditingBill({ ...bill, _printOnOpen: true });
    setCurrentView('new');
  };

  const handleDuplicateInvoice = (bill) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    const clone = JSON.parse(JSON.stringify(bill));
    clone._isDuplicate = true;
    setEditingBill(clone);
    setCurrentView('new');
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

  const handleConvertToInvoice = (bill) => {
    setEditorKey((k) => k + 1);
    sessionStorage.removeItem('gst_invoiceDraft');
    const clone = JSON.parse(JSON.stringify(bill));
    clone._isDuplicate = true;
    clone._convertToType = 'tax-invoice';
    setEditingBill(clone);
    setCurrentView('new');
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
      clients: 'clients',
      inventory: 'inventory',
      expenses: 'expenses',
      purchases: 'purchases',
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

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard', module: 'dashboard' },
    { id: 'invoices', icon: FileText, label: 'Invoices', module: 'dashboard' },
    { id: 'new', icon: Plus, label: 'New Invoice', onClick: handleNewInvoice, module: 'invoicing' },
    { id: 'clients', icon: Users, label: 'Clients', module: 'clients' },
    { id: 'inventory', icon: Package, label: 'Products', module: 'inventory' },
    { id: 'expenses', icon: Wallet, label: 'Expenses', module: 'expenses' },
    { id: 'purchases', icon: ShoppingCart, label: 'Purchases', module: 'purchases' },
    { id: 'recurring', icon: RefreshCw, label: 'Recurring', module: 'recurring' },
    { id: 'receipts', icon: Receipt, label: 'Receipts', module: 'receipts' },
    { id: 'reports', icon: BarChart3, label: 'Reports', module: 'reports' },
    { id: 'filing', icon: BookOpen, label: 'GST Returns', module: 'gstReturns' },
    { id: 'incometax', icon: Calculator, label: 'Income Tax', module: 'incomeTax' },
    // v1.10.75 - opens the online documentation, which covers every screen
    // and stays current; the old built-in guide had fallen far behind.
    { id: 'guide', icon: HelpCircle, label: 'User Guide', module: 'dashboard', onClick: openDocs }, // gated by dashboard so it's always available
  ].filter((item) => showIfModule(item.module));

  // Command palette actions — declared here (not earlier) because the deps
  // array references `navItems` and `handleNewInvoice`, which are consts.
  // Reading a const before its declaration triggers a Temporal Dead Zone
  // ReferenceError ("Cannot access 'X' before initialization") at runtime.
  const paletteActions = useMemo(() => {
    const acts = [
      {
        label: 'New Invoice',
        hint: 'Ctrl+N',
        category: 'action',
        run: () => {
          handleNewInvoice();
        },
      },
    ];
    navItems.forEach((item) => {
      if (item.id === 'new') return; // already covered above
      acts.push({
        label: `Go to ${item.label}`,
        hint: '',
        category: 'nav',
        run: item.onClick || (() => setCurrentView(item.id)),
      });
    });
    acts.push({
      label: 'Go to Settings',
      hint: '',
      category: 'nav',
      run: () => setCurrentView('settings'),
    });
    acts.push({ label: 'Toggle dark mode', hint: '', category: 'action', run: toggleDark });
    acts.push({
      label: 'Show keyboard shortcuts',
      hint: 'Ctrl+/',
      category: 'help',
      run: () => setShowShortcutsHelp(true),
    });
    // v1.9.4 — cross-app search: invoices, clients, products
    // v1.10.5 — audit H24 fix. Prior code dispatched
    // `CustomEvent('fgsb-open-bill', { detail: b.id })` but no one
    // listened for it — selecting an invoice in the palette silently
    // dropped the ID and just landed on Dashboard. Now: reuse
    // handleEditInvoice() directly, which is already the canonical way
    // to open a bill for editing (works from Dashboard row-click too).
    searchCorpus.bills.forEach((b) => {
      acts.push({
        label: `📄 ${b.invoiceNumber || 'INV-?'} — ${b.clientName || 'No client'}`,
        hint: b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '',
        category: 'invoice',
        run: () => handleEditInvoice(b),
      });
    });
    searchCorpus.clients.forEach((c) => {
      acts.push({
        label: `👤 ${c.name} — client${c.gstin ? ' · GSTIN: ' + c.gstin : ''}`,
        hint: c.phone || c.email || '',
        category: 'client',
        run: () => setCurrentView('clients'),
      });
    });
    searchCorpus.products.forEach((p) => {
      acts.push({
        label: `📦 ${p.name} — product${p.hsn ? ' · HSN: ' + p.hsn : ''}`,
        hint: (p.stock ?? 0) + ' in stock',
        category: 'product',
        run: () => setCurrentView('inventory'),
      });
    });
    // Settings sections (jump to specific area)
    // v1.10.74 - these all used to just open Settings at the top. Each now
    // names its section id; after Settings mounts (it's lazy-loaded, so retry
    // briefly) we click that section's "Jump to" chip, which already scrolls
    // below the sticky bars.
    const openSettingsAt = (sectionId) => {
      setCurrentView('settings');
      let tries = 0;
      const jump = () => {
        const chip = document.querySelector(`.settings-jumpnav a[href="#${sectionId}"]`);
        if (chip && document.getElementById(sectionId)) chip.click();
        else if (++tries < 30) setTimeout(jump, 100);
      };
      setTimeout(jump, 50);
    };
    const settingsJumps = [
      ['Company profile', 'section-company'],
      ['Payment accounts', 'section-company'],
      ['Print & PDF Settings', 'section-print'],
      ['PDF Style Editor', 'section-print'],
      ['Business type presets', 'section-print'],
      ['Section labels', 'section-print'],
      ['Watermarks', 'section-print'],
      ['Multi-copy print', 'section-print'],
      ['Digital signature', 'section-company'],
      ['Company letterhead', 'section-print'],
      ['Modules', 'section-modules'],
      ['Region preference', 'section-region'],
      ['Google Drive backup', 'section-cloud'],
    ];
    settingsJumps.forEach(([s, sectionId]) => {
      acts.push({
        label: `⚙️ Settings → ${s}`,
        hint: '',
        category: 'settings',
        run: () => openSettingsAt(sectionId),
      });
    });
    return acts;
  }, [navItems, handleNewInvoice, searchCorpus]);

  const filteredPalette = paletteActions.filter(
    (a) => !paletteQuery.trim() || a.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );

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

  if (serverDown) {
    return (
      <div className="server-down-overlay">
        <div className="server-down-modal">
          <FileText size={48} color="#3b82f6" />
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

  return (
    <AppShell autoHideSidebar={sidebarAutoHide}>
      {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
      {showResumeSetupPill && (
        <button
          type="button"
          onClick={() => setShowWizard(true)}
          title="Come back to the setup wizard — pick a business type, paper size, and language."
          style={{
            // Above the docked Save bar on Settings, so it never covers Save.
            position: 'fixed',
            bottom: currentView.startsWith('settings') ? '5.5rem' : '1.25rem',
            right: '1.25rem',
            zIndex: 9998,
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
          }}
        >
          ✨ Finish setup
        </button>
      )}
      <Sidebar
        me={me}
        signOut={signOut}
        handleSwitchOrg={handleSwitchOrg}
        profile={profile}
        navItems={navItems}
        currentView={currentView}
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

      {showInstallBanner && (
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
      )}
      <div className="main-content">
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
          onNewInvoice={handleNewInvoice}
          onOpenPalette={() => setShowPalette(true)}
          canWrite={can('invoice:write')}
        />
        {/* v1.10.4 — All lazy views under one Suspense boundary. Only the matched view's chunk actually loads.
             `key={businessKey}` remounts the screens that read the business once when they open, so a business
             switch never leaves the previous company's records on screen (v1.10.66, #64 item 1). */}
        <Suspense fallback={<ViewLoading />}>
          {printLoadedFor !== businessKey ? (
            <ViewLoading />
          ) : (
            <ScreenBoundary resetKey={location.pathname}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <Dashboard
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
                  path="/invoices/new"
                  element={
                    <InvoiceGenerator
                      key={editorKey}
                      onBack={() => {
                        setEditingBill(null);
                        setCurrentView('dashboard');
                      }}
                      profile={profile}
                      editingBill={editingBill}
                    />
                  }
                />
                <Route
                  path="/clients"
                  element={
                    <ClientsView
                      onNew={handleNewInvoice}
                      onEdit={handleEditInvoice}
                      onDuplicate={handleDuplicateInvoice}
                    />
                  }
                />
                <Route path="/products" element={<InventoryView />} />
                <Route path="/expenses" element={<ExpenseTracker key={businessKey} />} />
                <Route path="/purchases" element={<PurchaseBills key={businessKey} />} />
                <Route
                  path="/recurring"
                  element={<RecurringInvoices key={businessKey} onEdit={handleEditInvoice} />}
                />
                <Route path="/receipts" element={<ReceiptVoucher key={businessKey} />} />
                <Route path="/reports" element={<ReportsView key={businessKey} />} />
                <Route path="/gst-returns" element={<Navigate to="/gst-returns/gstr1" replace />} />
                <Route path="/gst-returns/:tab" element={<GstReturnsPage key={businessKey} />} />
                <Route
                  path="/income-tax"
                  element={
                    hasFeature('income-tax') ? (
                      <IncomeTax key={businessKey} />
                    ) : (
                      <LockedFeature name="Income tax" />
                    )
                  }
                />
                <Route path="/settings" element={<Navigate to="/settings/business" replace />} />
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
                  path="/settings/security"
                  element={
                    <SettingsLayout>
                      <SecurityPage />
                    </SettingsLayout>
                  }
                />
                <Route path="/accept-invite/:id" element={<AcceptInvitePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ScreenBoundary>
          )}
        </Suspense>
        {/* Version + ledgora line: Dashboard only, so it never takes space on working screens. */}
        {currentView === 'dashboard' && <AppFooter />}
      </div>

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

      <ShortcutsHelp open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />

      {/* Add a branch (organization accounts) — created on the account server,
          then switched into so the user is invoicing from it immediately. */}
      {showBranchModal && (
        <BranchModal onClose={() => setShowBranchModal(false)} onCreated={handleBranchCreated} />
      )}

      <ToastContainer />
      <ConfirmModalContainer />
    </AppShell>
  );
}

export default App;
