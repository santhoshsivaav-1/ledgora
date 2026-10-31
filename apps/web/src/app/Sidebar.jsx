import { Fragment, useEffect, useState } from 'react';
import {
  FileText,
  Menu,
  Building2,
  ChevronDown,
  Pencil,
  Plus,
  Sun,
  Moon,
  Settings,
  Users,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { NotificationButton } from './NotificationBell';

// The left menu and the phone top bar (change 3.5): who is signed in, the business switcher, the screens, and the
// account shortcuts. It draws what it is given; App.jsx owns the state (profiles, branches, notifications, theme).
// The menu is grouped by what people do: sell, stock and buying, then reports and tax (change 3.5).
const NAV_GROUPS = { 'sales-menu': 'Sell', inventory: 'Stock and buying', reports: 'Reports and tax' };

// The Sales entry opens into a page per stage of the sales flow. It stays open while you are on one of them, and
// remembers whether you folded it the rest of the time.
function NavParent({ item, currentView, setCurrentView }) {
  const hasActive = item.children.some((c) => c.id === currentView);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('ledgora_salesMenuOpen') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);
  const toggle = (e) => {
    e.stopPropagation(); // the menu's own click handler closes the phone menu; folding a group should not
    setOpen((v) => {
      try {
        localStorage.setItem('ledgora_salesMenuOpen', v ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !v;
    });
  };
  return (
    <>
      <button
        type="button"
        className={`nav-btn nav-parent${hasActive && !open ? ' nav-parent-active' : ''}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <item.icon size={18} /> <span>{item.label}</span>
        <ChevronRight size={15} className={`nav-chevron${open ? ' nav-chevron-open' : ''}`} />
      </button>
      {open && (
        <div className="nav-children">
          {item.children.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`nav-btn nav-sub-btn ${currentView === c.id ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView(c.id)}
            >
              <c.icon size={16} /> <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default function Sidebar({
  me,
  signOut,
  handleSwitchOrg,
  profile,
  navItems,
  currentView,
  setCurrentView,
  can,
  notifTotal,
  setShowNotifs,
  darkMode,
  toggleDark,
  serverStatus,
  sidebarAutoHide,
  toggleSidebarAutoHide,
  navOpen,
  setNavOpen,
  closeNavAfterPick,
}) {
  return (
    <>
      {/* v1.10.66 (#59) — phone-only top bar with the menu button. CSS hides it
          on wider screens, where the sidebar is always shown. */}
      <div className="mobile-topbar">
        <button
          type="button"
          className="mobile-topbar-btn"
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          aria-expanded={navOpen}
        >
          <Menu size={22} />
        </button>
        <span className="mobile-topbar-title">GST Billing</span>
        <span className="mobile-topbar-business">{profile?.businessName || ''}</span>
      </div>
      {navOpen && (
        <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}
      <div className={`sidebar${navOpen ? ' sidebar-open' : ''}`} onClick={closeNavAfterPick}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <FileText size={22} />
          </div>
          <div>
            <h2 className="sidebar-title">GST Billing</h2>
            <p className="sidebar-subtitle">by ledgora</p>
          </div>
          {/* Auto-hide as a ☰ button (was a text checkbox): pressed = the menu
              shrinks to icons and opens when pointed at. */}
          <button
            type="button"
            className={`sidebar-autohide-toggle${sidebarAutoHide ? ' on' : ''}`}
            aria-pressed={sidebarAutoHide}
            aria-label="Auto-hide menu"
            title={
              sidebarAutoHide
                ? 'Keep this menu open'
                : 'Auto-hide this menu: icons only, it opens when you point at it'
            }
            onClick={(e) => {
              e.stopPropagation();
              toggleSidebarAutoHide(!sidebarAutoHide);
            }}
          >
            <Menu size={18} />
          </button>
        </div>

        {me && (
          <div className="account-bar" title={me.user.email || me.user.phoneNumber || ''}>
            <span className="account-bar-who">
              <b>{me.user.name || me.user.email || me.user.phoneNumber}</b>
              {me.organizations?.length > 1 && (
                <select
                  className="org-switcher"
                  value={me.organization.id}
                  onChange={(e) => handleSwitchOrg(e.target.value)}
                  title="Switch organization"
                  aria-label="Switch organization"
                >
                  {me.organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
              {me.organizations?.length <= 1 && (
                <span>
                  {me.organization.name} · {me.role}
                </span>
              )}
            </span>
            <button
              type="button"
              className="account-bar-logout"
              onClick={signOut}
              title="Log out of this account"
            >
              <LogOut size={15} /> Log out
            </button>
          </div>
        )}
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Fragment key={item.id}>
              {NAV_GROUPS[item.id] && <div className="nav-group-label">{NAV_GROUPS[item.id]}</div>}
              {item.children ? (
                <NavParent item={item} currentView={currentView} setCurrentView={setCurrentView} />
              ) : (
                <button
                  className={`nav-btn ${currentView === item.id ? 'nav-btn-active' : ''}`}
                  onClick={item.onClick || (() => setCurrentView(item.id))}
                >
                  <item.icon size={18} /> {item.label}
                </button>
              )}
            </Fragment>
          ))}
          <div
            style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
          >
            {/* Notification bell — opens a popover listing overdue / due-soon
                invoices, GST filing deadlines, and low-stock items. Each row
                is a single click away from the page that fixes it. */}
            <NotificationButton total={notifTotal} onClick={() => setShowNotifs((v) => !v)} />
            <button
              className="nav-btn"
              onClick={toggleDark}
              title={darkMode ? 'Light Mode' : 'Dark Mode'}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
              {darkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
            <button
              className={`nav-btn ${currentView.startsWith('settings') ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('settings')}
            >
              <Settings size={18} /> Settings
            </button>
            {can('team:read') && (
              <button
                className={`nav-btn ${currentView === 'team' ? 'nav-btn-active' : ''}`}
                onClick={() => setCurrentView('team')}
              >
                <Users size={18} /> Team
              </button>
            )}
            <button
              className={`nav-btn ${currentView === 'security' ? 'nav-btn-active' : ''}`}
              onClick={() => setCurrentView('security')}
            >
              <ShieldCheck size={18} /> Security
            </button>
            <div className={`server-status server-status-${serverStatus}`}>
              <span className="server-status-dot" />
              {serverStatus === 'online'
                ? 'App Ready'
                : serverStatus === 'offline'
                  ? 'App Not Running'
                  : 'Connecting...'}
            </div>
          </div>
        </nav>
      </div>
    </>
  );
}
