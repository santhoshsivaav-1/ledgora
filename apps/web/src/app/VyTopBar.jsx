import { Bell, LayoutTemplate, LogOut, Menu as MenuIcon, Moon, Plus, Settings, ShieldCheck, Sun, Users } from 'lucide-react';
import BusinessNameField from './BusinessNameField';
import FYSwitcher from './FYSwitcher';
import Menu from '../components/ui/Menu';
import { Avatar, Badge } from '../components/ui/Display';
import { SetupDot } from '../features/utilities/SetupPage';

// The new top bar (Vyapar parity P0-S2): business name (with the set-up dot), where you are, then the FY, the
// page's New button, notifications, settings and the account menu. Everything the classic sidebar kept at its
// foot (theme, team, security, log out, the server light) lives in the account menu.

const STATUS_TEXT = { online: 'App ready', offline: 'App not running', checking: 'Connecting…' };

export default function VyTopBar({
  profile,
  crumb,
  me,
  onSaveBusinessName,
  onEditBusiness,
  onSetup,
  onNew,
  newLabel,
  canWrite,
  notifTotal,
  onBell,
  onGo,
  canTeam,
  darkMode,
  toggleDark,
  serverStatus,
  onSwitchOrg,
  signOut,
  onClassic,
  onOpenMenu,
}) {
  const who = me?.user?.name || me?.user?.email || me?.user?.phoneNumber || 'Account';
  const orgs = me?.organizations || [];
  const accountItems = [
    ...orgs
      .filter((o) => o.id !== me?.organization?.id)
      .map((o) => ({ label: `Switch to ${o.name}`, icon: Users, onSelect: () => onSwitchOrg(o.id) })),
    ...(orgs.length > 1 ? ['sep'] : []),
    ...(canTeam ? [{ label: 'Team', icon: Users, onSelect: () => onGo('/settings/team') }] : []),
    { label: 'Security', icon: ShieldCheck, onSelect: () => onGo('/settings/security') },
    { label: darkMode ? 'Light mode' : 'Dark mode', icon: darkMode ? Sun : Moon, onSelect: toggleDark },
    { label: 'Use the classic layout', icon: LayoutTemplate, onSelect: onClassic },
    'sep',
    ...(me ? [{ label: 'Log out', icon: LogOut, tone: 'danger', onSelect: signOut }] : []),
  ];

  return (
    <header className="vy-topbar">
      <button type="button" className="ui-icon-btn vy-topbar-menu" onClick={onOpenMenu} aria-label="Open menu">
        <MenuIcon size={20} />
      </button>
      <BusinessNameField profile={profile} onSave={onSaveBusinessName} onEdit={onEditBusiness} onSetup={onSetup} />
      {crumb && (
        <div className="vy-crumb" aria-label="You are here">
          {crumb.group && (
            <>
              <span>{crumb.group}</span>
              <span aria-hidden="true">›</span>
            </>
          )}
          <b>{crumb.label}</b>
        </div>
      )}
      <div className="vy-topbar-right">
        <FYSwitcher />
        {canWrite && (
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={onNew} title={`${newLabel} (Alt+N)`}>
            <Plus size={15} aria-hidden="true" />
            <span className="vy-new-label">{newLabel}</span>
          </button>
        )}
        <span className="vy-icon-wrap">
          <SetupDot />
          <button type="button" className="ui-icon-btn" onClick={onBell} aria-label={notifTotal ? `Notifications, ${notifTotal} new` : 'Notifications'} title="Notifications">
            <Bell size={18} />
          </button>
          {notifTotal > 0 && <Badge>{notifTotal > 99 ? '99+' : notifTotal}</Badge>}
        </span>
        <button type="button" className="ui-icon-btn" onClick={() => onGo('/settings')} aria-label="Settings" title="Settings">
          <Settings size={18} />
        </button>
        <span className="vy-icon-wrap" title={`${who}${me?.organization ? ` · ${me.organization.name} · ${me.role}` : ''} — ${STATUS_TEXT[serverStatus] || ''}`}>
          <Menu
            label="Account"
            items={[{ label: who, disabled: true }, 'sep', ...accountItems]}
            trigger={<Avatar name={who} size={30} />}
            triggerClassName="vy-avatar-btn"
          />
          <span className="vy-status-dot" data-status={serverStatus} aria-label={STATUS_TEXT[serverStatus]} role="img" />
        </span>
      </div>
    </header>
  );
}
