import { useTabStore } from '../../stores/tabStore'
import { FORMAT_ICONS } from '../../types/tabs'

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)

  if (tabs.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      overflowX: 'auto',
      minHeight: 'var(--tabbar-height)'
    }}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onMouseDown={(e) => {
              // Middle click to close
              if (e.button === 1) {
                e.preventDefault()
                closeTab(tab.id)
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 12px',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
              borderRight: '1px solid var(--border)',
              background: isActive ? 'var(--bg-primary)' : 'transparent',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'
            }}
            onMouseLeave={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            <span>{FORMAT_ICONS[tab.format]}</span>
            <span>{tab.fileName}{tab.isDirty ? ' *' : ''}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              style={{
                marginLeft: 4,
                padding: '0 2px',
                fontSize: 14,
                lineHeight: 1,
                borderRadius: 2,
                color: 'var(--text-muted)',
                opacity: 0.6
              }}
              onMouseEnter={(e) => {
                ;(e.target as HTMLElement).style.opacity = '1'
                ;(e.target as HTMLElement).style.color = 'var(--danger)'
              }}
              onMouseLeave={(e) => {
                ;(e.target as HTMLElement).style.opacity = '0.6'
                ;(e.target as HTMLElement).style.color = 'var(--text-muted)'
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
