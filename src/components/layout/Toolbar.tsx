import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { openFile, saveActiveTab, saveActiveTabAs } from '../../lib/actions'

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 4,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export default function Toolbar() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.3,
          color: 'var(--text-primary)',
          marginRight: 12,
        }}
      >
        Open Satchel
      </span>

      <button style={btnStyle} onClick={() => void openFile()} title="Open (Ctrl+O)">
        Open
      </button>
      <button
        style={btnStyle}
        onClick={() => void saveActiveTab()}
        disabled={!activeTabId}
        title="Save (Ctrl+S)"
      >
        Save
      </button>
      <button
        style={btnStyle}
        onClick={() => void saveActiveTabAs()}
        disabled={!activeTabId}
        title="Save As (Ctrl+Shift+S)"
      >
        Save As…
      </button>

      <div style={{ flex: 1 }} />

      <button style={btnStyle} onClick={toggleSidebar} title="Toggle sidebar (Ctrl+B)">
        {sidebarOpen ? '⟨ Hide' : 'Show ⟩'}
      </button>
    </div>
  )
}
