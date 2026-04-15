import Toolbar from './Toolbar'
import TabBar from './TabBar'
import StatusBar from './StatusBar'
import ContentRouter from './ContentRouter'
import CommandPalette from '../CommandPalette'
import FindReplace from '../FindReplace'
import { useUIStore } from '../../stores/uiStore'
import { useTabStore } from '../../stores/tabStore'
import { getHandler } from '../../formats/registry'

export default function AppShell() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const handler = activeTab ? getHandler(activeTab.format) : undefined
  const SidebarComponent = handler?.Sidebar
  const hasSidebar = sidebarOpen && activeTab && SidebarComponent
  const RibbonComponent = handler?.ToolbarExtras

  // Dynamic row heights based on whether we have a ribbon
  const hasRibbon = activeTab && RibbonComponent
  const gridRows = hasRibbon
    ? 'var(--toolbar-height) var(--ribbon-height) 1fr var(--statusbar-height)'
    : 'var(--toolbar-height) 1fr var(--statusbar-height)'

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: gridRows,
      gridTemplateColumns: hasSidebar ? 'var(--sidebar-width) 1fr' : '1fr',
      height: '100vh',
      overflow: 'hidden'
    }}>
      {/* Row 1: File toolbar + tab bar combined */}
      <Toolbar style={{ gridColumn: '1 / -1' }} />

      {/* Row 2: Ribbon (format-specific, only if handler provides one) */}
      {hasRibbon && RibbonComponent && (
        <div style={{ gridColumn: '1 / -1' }}>
          <RibbonComponent tabId={activeTabId!} />
        </div>
      )}

      {/* Row 3: Sidebar + Content */}
      {hasSidebar && SidebarComponent && <SidebarComponent tabId={activeTabId!} />}
      <main style={{
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}>
        <FindReplace />
        <ContentRouter />
      </main>

      {/* Row 4: Status bar */}
      <StatusBar style={{ gridColumn: '1 / -1' }} />

      {/* Overlays */}
      <CommandPalette />
    </div>
  )
}
