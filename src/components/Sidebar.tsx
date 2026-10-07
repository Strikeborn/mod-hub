import type { HubTab } from '../context/HubNavigation';

type Props = {
  tab: HubTab;
  onTab: (t: HubTab) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const MAIN: { id: HubTab; label: string }[] = [
  { id: 'library', label: 'All mods' },
  { id: 'steam', label: 'Steam' },
  { id: 'nexus', label: 'Nexus' },
  { id: 'games', label: 'Games' },
  { id: 'loadouts', label: 'Loadouts' },
];

function GearIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.66 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.04.24.25.42.49.42h3.84c.25 0 .45-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z"
      />
    </svg>
  );
}

export function Sidebar({ tab, onTab, collapsed, onToggleCollapsed }: Props) {
  return (
    <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="sidebar-head">
        <h1 title="Mod Hub">{collapsed ? 'MH' : 'Mod Hub'}</h1>
        <button
          type="button"
          className="sidebar-collapse-btn"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
      <nav className="sidebar-nav sidebar-nav-main">
        {MAIN.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`nav-btn ${tab === id ? 'active' : ''}`}
            title={collapsed ? label : undefined}
            onClick={() => onTab(id)}
          >
            {collapsed ? label.charAt(0) : label}
          </button>
        ))}
      </nav>
      <nav className="sidebar-nav sidebar-nav-footer">
        <button
          type="button"
          className={`nav-btn nav-btn-icon ${tab === 'settings' ? 'active' : ''}`}
          title={collapsed ? 'Settings' : undefined}
          onClick={() => onTab('settings')}
        >
          <GearIcon />
          {!collapsed && <span>Settings</span>}
        </button>
      </nav>
    </aside>
  );
}
