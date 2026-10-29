// The frame around every signed-in screen (change 3.5): the sidebar sits beside the main column, and the sidebar can
// shrink to icons. Screens and overlays are passed in as children, so this file knows nothing about any of them.
export default function AppShell({ autoHideSidebar, children }) {
  return (
    <div className={`app-layout${autoHideSidebar ? ' sidebar-autohide' : ''}`}>{children}</div>
  );
}
