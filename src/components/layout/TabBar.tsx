import { useTabStore } from '../../stores/tabStore'
import { useFormatStore } from '../../stores/formatStore'
import { getHandler } from '../../formats/registry'
import { FORMAT_ICONS } from '../../types/tabs'

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)

  if (tabs.length === 0) {
    return (
      <div
        style={{
          gridColumn: '1 / -1',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          minHeight: 'var(--tabbar-height)',
        }}
      />
    )
  }

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
        minHeight: 'var(--tabbar-height)',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                const handler = getHandler(tab.format)
                handler?.cleanup?.(tab.id)
                useFormatStore.getState().clearFormatState(tab.id)
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
            }}
          >
            <span aria-hidden>{FORMAT_ICONS[tab.format]}</span>
            <span>
              {tab.fileName}
              {tab.isDirty ? ' *' : ''}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                const handler = getHandler(tab.format)
                handler?.cleanup?.(tab.id)
                useFormatStore.getState().clearFormatState(tab.id)
                closeTab(tab.id)
              }}
              style={{
                marginLeft: 4,
                padding: '0 4px',
                fontSize: 14,
                lineHeight: 1,
                color: 'var(--text-muted)',
                opacity: 0.6,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.color = 'var(--danger)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.6'
                e.currentTarget.style.color = 'var(--text-muted)'
              }}
              aria-label={`Close ${tab.fileName}`}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
