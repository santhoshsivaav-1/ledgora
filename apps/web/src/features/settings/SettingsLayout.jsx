import { NavLink } from 'react-router';
import { SETTINGS_TABS as NEW_TABS } from '@ledgora/contracts';
import { SETTINGS_TABS } from './tabs';
import { useEntitlements } from '../billing/useEntitlements';

// The tab bar over every Settings page (change 3.19): one URL per page, so a copied link or a reload lands on the same one.
export default function SettingsLayout({ children }) {
  const { can } = useEntitlements();
  return (
    <div>
      <nav className="settings-tabs" aria-label="Settings pages">
        {NEW_TABS.map(({ id, label, hint }) => (
          <NavLink key={id} to={`/settings/${id}`} title={hint} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
        ))}
      </nav>
      {/* The four pages from before Phase 8 stay until Phase 11, so a rollback has somewhere to land. */}
      <nav className="settings-tabs" aria-label="Earlier settings pages">
        {SETTINGS_TABS.map(([id, label, hint]) => (
          <NavLink key={id} to={`/settings/${id}`} title={hint} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
        ))}
        {can('team:read') && <NavLink to="/settings/team" className={({ isActive }) => (isActive ? 'active' : '')}>Team</NavLink>}
        {can('team:read') && <NavLink to="/settings/roles" className={({ isActive }) => (isActive ? 'active' : '')}>Account Access</NavLink>}
        <NavLink to="/settings/security" className={({ isActive }) => (isActive ? 'active' : '')}>Security</NavLink>
        <NavLink to="/settings/billing" className={({ isActive }) => (isActive ? 'active' : '')}>Plan &amp; billing</NavLink>
      </nav>
      {children}
    </div>
  );
}
