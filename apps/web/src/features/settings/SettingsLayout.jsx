import { NavLink } from 'react-router';
import { SETTINGS_TABS as NEW_TABS } from '@ledgora/contracts';
import { SETTINGS_TABS } from './tabs';
import { useEntitlements } from '../billing/useEntitlements';
import { useSession } from '../auth/SessionContext';
import './settingsLayout.css';

// The navigation beside every Settings page (change 3.19, one list since audit U5): one URL per page, so a copied link or a reload
// lands on the same one. Groups, not two stacked rows of tabs; on a narrow screen the list runs along the top and scrolls.
const link = ({ isActive }) => (isActive ? 'active' : '');

export default function SettingsLayout({ children }) {
  const { can } = useEntitlements();
  const { me } = useSession();
  const group = (title, items) => (
    <div className="settings-group" key={title}>
      <p className="settings-group-title">{title}</p>
      {items}
    </div>
  );
  return (
    <div className="settings-shell">
      <nav className="settings-side" aria-label="Settings">
        {group('Preferences', NEW_TABS.map(({ id, label, hint }) => (
          <NavLink key={id} to={`/settings/${id}`} title={hint} className={link}>{label}</NavLink>
        )))}
        {group('Business and data', SETTINGS_TABS.map(([id, label, hint]) => (
          <NavLink key={id} to={`/settings/${id}`} title={hint} className={link}>{label}</NavLink>
        )))}
        {group('Account', [
          can('team:read') && <NavLink key="team" to="/settings/team" className={link}>Team</NavLink>,
          can('team:read') && <NavLink key="roles" to="/settings/roles" className={link}>Account Access</NavLink>,
          <NavLink key="security" to="/settings/security" className={link}>Security</NavLink>,
          <NavLink key="billing" to="/settings/billing" className={link}>Plan &amp; billing</NavLink>,
        ])}
        {me?.platformAdmin && group('Platform', [<NavLink key="admin" to="/admin" className={link}>Platform admin</NavLink>])}
      </nav>
      <div className="settings-body">{children}</div>
    </div>
  );
}
