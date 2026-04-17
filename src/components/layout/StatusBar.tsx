import { useEffect, useState } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { appApi } from '../../lib/ipc'
import { FORMAT_NAMES } from '../../types/tabs'

export default function StatusBar() {
  const [version, setVersion] = useState<string | null>(null)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const active = tabs.find((t) => t.id === activeTabId)
  const autoSaveStatus = useUIStore((s) => s.autoSaveStatus)
  const autoSaveEnabled = useUIStore((s) => s.autoSaveEnabled)

  useEffect(() => {
    appApi.version().then(setVersion).catch(() => setVersion(null))
  }, [])

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 14,
        fontSize: 11,
        color: 'var(--text-muted)',
        background: 'var(--bg-primary)',
        borderTop: '1px solid var(--border)',
      }}
    >
      <span>{active ? FORMAT_NAMES[active.format] : 'No file open'}</span>
      {active?.filePath && (
        <span
          title={active.filePath}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 500,
          }}
        >
          {active.filePath}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {autoSaveEnabled && active?.isDirty && autoSaveStatus === 'idle' && (
        <span title="Autosave is on \u2014 will save shortly">Unsaved \u2022 autosave pending</span>
      )}
      {autoSaveStatus === 'saving' && (
        <span style={{ color: 'var(--warning)' }}>Saving\u2026</span>
      )}
      {autoSaveStatus === 'saved' && (
        <span style={{ color: 'var(--success)' }}>Saved</span>
      )}
      <span>Tauri + Rust</span>
      {version && <span>v{version}</span>}
    </div>
  )
}
