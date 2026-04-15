import { CSSProperties, useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useTabStore } from '../../stores/tabStore'
import { getHandler } from '../../formats/registry'
import { openFile, saveFile, saveFileAs } from '../../App'
import { FORMAT_ICONS } from '../../types/tabs'
import { getAvailableConversions } from '../../services/conversionService'
import ConvertDialog from '../ConvertDialog'

interface Props {
  style?: CSSProperties
}

export default function Toolbar({ style }: Props) {
  const { zoom, zoomIn, zoomOut } = useUIStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const handler = activeTab ? getHandler(activeTab.format) : undefined
  const [showConvert, setShowConvert] = useState(false)
  const hasConversions = activeTab ? getAvailableConversions(activeTab.format).length > 0 : false

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)',
      ...style
    }}>
      {/* File ops */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px', flexShrink: 0 }}>
        <TinyBtn label="Open" onClick={openFile} />
        <TinyBtn label="Save" onClick={saveFile} disabled={!activeTab} />
        <TinyBtn label="Save As" onClick={saveFileAs} disabled={!activeTab} />
        {activeTab && hasConversions && (
          <TinyBtn label="Convert" onClick={() => setShowConvert(true)} />
        )}
      </div>

      <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden', flex: 1, minWidth: 0 }}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '0 10px', cursor: 'pointer', fontSize: 11,
                whiteSpace: 'nowrap', minWidth: 0,
                borderRight: '1px solid var(--border)',
                background: isActive ? 'var(--bg-surface)' : 'transparent',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'background 0.1s'
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: 12 }}>{FORMAT_ICONS[tab.format]}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.fileName}{tab.isDirty ? ' *' : ''}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                style={{ marginLeft: 2, fontSize: 11, padding: '0 2px', color: 'var(--text-muted)', opacity: 0.5, lineHeight: 1 }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      {/* Right side: zoom + file name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', flexShrink: 0 }}>
        {activeTab && handler?.capabilities.zoom && (
          <>
            <TinyBtn label="−" onClick={zoomOut} />
            <span style={{ fontSize: 11, minWidth: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              {Math.round(zoom * 100)}%
            </span>
            <TinyBtn label="+" onClick={zoomIn} />
          </>
        )}
      </div>

      {showConvert && <ConvertDialog onClose={() => setShowConvert(false)} />}
    </div>
  )
}

function TinyBtn({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '3px 8px', fontSize: 11, borderRadius: 3,
      background: 'transparent', color: 'var(--text-secondary)',
      border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1
    }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >{label}</button>
  )
}
