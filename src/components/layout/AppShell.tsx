import { useUIStore } from '../../stores/uiStore'
import { useTabStore } from '../../stores/tabStore'
import { getHandler } from '../../formats/registry'
import Toolbar from './Toolbar'
import TabBar from './TabBar'
import StatusBar from './StatusBar'
import ContentRouter from './ContentRouter'

export default function AppShell() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const handler = activeTab ? getHandler(activeTab.format) : undefined
  const SidebarComponent = handler?.Sidebar
  const RibbonComponent = handler?.ToolbarExtras
  const hasSidebar = sidebarOpen && activeTab && SidebarComponent
  const hasRibbon = activeTab && RibbonComponent

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: hasRibbon
          ? 'var(--toolbar-height) var(--tabbar-height) var(--ribbon-height) 1fr var(--statusbar-height)'
          : 'var(--toolbar-height) var(--tabbar-height) 1fr var(--statusbar-height)',
        gridTemplateColumns: hasSidebar ? 'var(--sidebar-width) 1fr' : '1fr',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <Toolbar />
      <TabBar />
      {hasRibbon && RibbonComponent && activeTabId && (
        <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid var(--border)' }}>
          <RibbonComponent tabId={activeTabId} />
        </div>
      )}

      {hasSidebar && SidebarComponent && activeTabId && (
        <aside
          style={{
            background: 'var(--bg-primary)',
            borderRight: '1px solid var(--border)',
            overflow: 'auto',
          }}
        >
          <SidebarComponent tabId={activeTabId} />
        </aside>
      )}

      <main
        style={{
          overflow: 'hidden',
          background: 'var(--bg-secondary)',
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <ContentRouter />
      </main>

      <StatusBar />
    </div>
  )
}
