import { NavLink } from 'react-router';
import { SETTINGS_TABS } from './tabs';
import { useEntitlements } from '../billing/useEntitlements';

// The tab bar over every Settings page (change 3.19): one URL per page, so a copied link or a reload lands on the same one.
export default function SettingsLayout({ children }) {
  const { can } = useEntitlements();
  return (
    <div>
      <nav className="settings-tabs" aria-label="Settings pages">
        {SETTINGS_TABS.map(([id, label, hint]) => (
          <NavLink key={id} to={`/settings/${id}`} title={hint} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
        ))}
        {can('team:read') && <NavLink to="/settings/team" className={({ isActive }) => (isActive ? 'active' : '')}>Team</NavLink>}
        <NavLink to="/settings/security" className={({ isActive }) => (isActive ? 'active' : '')}>Security</NavLink>
      </nav>
      {children}
    </div>
  );
}
