import { Building2, ChevronDown, Pencil, Plus, Search } from 'lucide-react';

// The strip above every screen (change 3.5): which business you are working in, a quick way to start an invoice, and the
// command palette. The business switcher used to sit in the sidebar.
export default function TopBar({
  profile,
  allProfiles,
  extraBranches,
  showProfileMenu,
  setShowProfileMenu,
  profileMenuRef,
  handleSwitchProfile,
  handleSwitchBranch,
  canManageBranches,
  setShowBranchModal,
  setCurrentView,
  onNewInvoice,
  newLabel = 'New invoice',
  onOpenPalette,
  canWrite,
}) {
  return (
    <div className="topbar">
      <div className="profile-switcher" ref={profileMenuRef} style={{ position: 'relative' }}>
        <div className="profile-switcher-row">
          <button
            className="profile-switcher-btn"
            onClick={() =>
              allProfiles.length + extraBranches.length > 1 && setShowProfileMenu((v) => !v)
            }
            title={
              allProfiles.length + extraBranches.length > 1
                ? 'Switch business / branch'
                : profile?.businessName || 'My Business'
            }
            style={{
              cursor: allProfiles.length + extraBranches.length > 1 ? 'pointer' : 'default',
            }}
          >
            <Building2 size={14} />
            <span className="profile-switcher-name">{profile?.businessName || 'My Business'}</span>
            {allProfiles.length + extraBranches.length > 1 && (
              <ChevronDown size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} />
            )}
          </button>
          <button
            className="profile-switcher-edit"
            onClick={() => {
              setShowProfileMenu(false);
              setCurrentView('settings');
            }}
            title="Edit business profile"
          >
            <Pencil size={13} />
          </button>
        </div>
        {showProfileMenu && (
          <div className="profile-switcher-menu">
            {allProfiles.map((bp) => (
              <button
                key={bp.id || bp.businessName}
                className={`profile-switcher-item${bp.businessName?.trim().toLowerCase() === profile?.businessName?.trim().toLowerCase() ? ' active' : ''}`}
                onClick={() => handleSwitchProfile(bp)}
              >
                {bp.businessName}
              </button>
            ))}
            {extraBranches.map((b) => (
              <button
                key={b.id}
                className="profile-switcher-item"
                title={`${b.state || ''}${b.gstin ? ` · ${b.gstin}` : ''} — no details saved on this computer yet`}
                onClick={() => handleSwitchBranch(b)}
              >
                {b.name}
                <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', opacity: 0.65 }}>
                  {b.gstin ? `(${b.gstin})` : '(not set up here)'}
                </span>
              </button>
            ))}
            {canManageBranches && (
              <button
                className="profile-switcher-item profile-switcher-manage"
                onClick={() => {
                  setShowProfileMenu(false);
                  setShowBranchModal(true);
                }}
              >
                <Plus size={12} style={{ display: 'inline' }} /> Add branch...
              </button>
            )}
            <button
              className="profile-switcher-item profile-switcher-manage"
              onClick={() => {
                setShowProfileMenu(false);
                setCurrentView('settings');
              }}
            >
              Manage profiles...
            </button>
          </div>
        )}
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-search"
          onClick={onOpenPalette}
          title="Jump to any screen or action"
        >
          <Search size={14} /> Search <kbd>Ctrl K</kbd>
        </button>
        {canWrite && (
          <button type="button" className="btn btn-primary topbar-new" onClick={onNewInvoice}>
            <Plus size={16} /> {newLabel}
          </button>
        )}
      </div>
    </div>
  );
}
