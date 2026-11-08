// The frame around every signed-in screen (change 3.5): the sidebar sits beside the main column, and the sidebar can
// shrink to icons. Screens and overlays are passed in as children, so this file knows nothing about any of them.
// `vyapar` draws the new shell's frame (styles/shell.css); `rail` is its icon-only menu (Alt+B).
export default function AppShell({ autoHideSidebar, vyapar = false, rail = false, children }) {
  if (vyapar) return <div className={`app-layout vy-shell${rail ? ' vy-rail' : ''}`}>{children}</div>;
  return (
    <div className={`app-layout${autoHideSidebar ? ' sidebar-autohide' : ''}`}>{children}</div>
  );
}
