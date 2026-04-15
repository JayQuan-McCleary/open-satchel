import { useState, useEffect, type CSSProperties } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { getHandler } from '../../formats/registry'
import { openFile, openFileFromPath, newDocument, newSpreadsheet, newMarkdown } from '../../App'
import { FORMAT_ICONS, type DocumentFormat } from '../../types/tabs'

interface RecentFileEntry {
  path: string
  name: string
  format: string
  lastOpened: number
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`
  return new Date(timestamp).toLocaleDateString()
}

function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path
  const parts = path.split(/[/\\]/)
  if (parts.length <= 3) return path
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

export default function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)

  if (!activeTabId) return <EmptyState />

  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab) return <EmptyState />

  const handler = getHandler(tab.format)
  if (!handler) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', flexDirection: 'column', gap: 8
      }}>
        <div style={{ fontSize: 32 }}>&#x1F6AB;</div>
        <div>Unsupported format: {tab.format}</div>
      </div>
    )
  }

  return <handler.Viewer tabId={activeTabId} />
}

// --- Quick Action Card ---

interface QuickAction {
  label: string
  shortcut?: string
  icon: string
  color: string
  onClick: () => void
}

function QuickActionCard({ action }: { action: QuickAction }) {
  const [hovered, setHovered] = useState(false)

  const baseStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '20px 16px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: hovered ? 'var(--bg-hover)' : 'var(--bg-surface)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
    boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.12)' : '0 1px 3px rgba(0,0,0,0.06)',
    minWidth: 130,
    flex: '1 1 130px',
    maxWidth: 180,
  }

  return (
    <div
      style={baseStyle}
      onClick={action.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: action.color + '18',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        transition: 'transform 0.15s ease',
        transform: hovered ? 'scale(1.1)' : 'scale(1)',
      }}>
        {action.icon}
      </div>
      <span style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-primary)',
        textAlign: 'center',
      }}>
        {action.label}
      </span>
      {action.shortcut && (
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          background: 'var(--bg-primary)',
          padding: '2px 6px',
          borderRadius: 4,
          fontFamily: 'monospace',
        }}>
          {action.shortcut}
        </span>
      )}
    </div>
  )
}

// --- Keyboard Shortcut Row ---

function ShortcutRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '4px 0',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</span>
      <kbd style={{
        fontSize: 10,
        fontFamily: 'monospace',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '2px 6px',
        color: 'var(--text-secondary)',
        marginLeft: 16,
        whiteSpace: 'nowrap',
      }}>
        {keys}
      </kbd>
    </div>
  )
}

// --- Fade-in keyframes injected once ---

let styleInjected = false
function injectFadeIn() {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
    @keyframes satchel-fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `
  document.head.appendChild(style)
}

// --- Main EmptyState / Welcome Screen ---

function EmptyState() {
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([])
  const [hoveredRecentIdx, setHoveredRecentIdx] = useState<number | null>(null)

  useEffect(() => {
    injectFadeIn()
    window.api.recent.get().then(setRecentFiles).catch(() => {})
  }, [])

  async function openRecentFile(entry: RecentFileEntry) {
    try {
      const result = await window.api.file.openPath(entry.path)
      if (result) {
        await openFileFromPath(result.path, result.bytes)
        const updated = await window.api.recent.get()
        setRecentFiles(updated)
      }
    } catch {
      await window.api.recent.remove(entry.path)
      const updated = await window.api.recent.get()
      setRecentFiles(updated)
    }
  }

  async function handleClearRecent() {
    await window.api.recent.clear()
    setRecentFiles([])
  }

  const quickActions: QuickAction[] = [
    { label: 'Open File', shortcut: 'Ctrl+O', icon: '\u{1F4C2}', color: '#3b82f6', onClick: openFile },
    { label: 'New Document', icon: '\u{1F4DD}', color: '#2563eb', onClick: newDocument },
    { label: 'New Spreadsheet', icon: '\u{1F4CA}', color: '#16a34a', onClick: newSpreadsheet },
    { label: 'New Markdown', icon: '\u{1F4D1}', color: '#8b5cf6', onClick: newMarkdown },
  ]

  const shortcuts = [
    { keys: 'Ctrl+O', desc: 'Open file' },
    { keys: 'Ctrl+S', desc: 'Save' },
    { keys: 'Ctrl+Shift+S', desc: 'Save As' },
    { keys: 'Ctrl+W', desc: 'Close tab' },
    { keys: 'Ctrl+K', desc: 'Command palette' },
    { keys: 'Ctrl+F', desc: 'Find' },
    { keys: 'Ctrl+H', desc: 'Find & Replace' },
    { keys: 'Ctrl+Tab', desc: 'Next tab' },
    { keys: 'Ctrl+B', desc: 'Toggle sidebar' },
  ]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      height: '100%',
      overflowY: 'auto',
      padding: '48px 24px',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxWidth: 640,
        width: '100%',
        animation: 'satchel-fadeInUp 0.4s ease both',
      }}>
        {/* Header */}
        <div style={{
          fontSize: 48,
          fontWeight: 800,
          letterSpacing: -2,
          color: 'var(--text-primary)',
          lineHeight: 1,
        }}>
          Open Satchel
        </div>
        <div style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          marginTop: 6,
          fontWeight: 500,
        }}>
          Free. Private. No email required.
        </div>
        <div style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          marginTop: 8,
          textAlign: 'center',
          lineHeight: 1.5,
          maxWidth: 400,
        }}>
          Open any file: PDF, Word, Excel, Markdown, Code, CSV, HTML, and more
        </div>

        {/* Quick Action Cards */}
        <div style={{
          display: 'flex',
          gap: 12,
          marginTop: 32,
          flexWrap: 'wrap',
          justifyContent: 'center',
          width: '100%',
          animation: 'satchel-fadeInUp 0.4s ease 0.1s both',
        }}>
          {quickActions.map((action) => (
            <QuickActionCard key={action.label} action={action} />
          ))}
        </div>

        {/* Recent Files */}
        {recentFiles.length > 0 && (
          <div style={{
            marginTop: 36,
            width: '100%',
            maxWidth: 500,
            animation: 'satchel-fadeInUp 0.4s ease 0.2s both',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
              padding: '0 4px',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Recent Files
              </span>
              <button
                onClick={handleClearRecent}
                style={{
                  fontSize: 10, color: 'var(--text-muted)', background: 'none',
                  border: 'none', cursor: 'pointer', padding: '2px 6px',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                Clear All
              </button>
            </div>
            <div style={{
              background: 'var(--bg-surface)',
              borderRadius: 8,
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}>
              {recentFiles.map((entry, i) => (
                <div
                  key={entry.path}
                  onClick={() => openRecentFile(entry)}
                  onMouseEnter={() => setHoveredRecentIdx(i)}
                  onMouseLeave={() => setHoveredRecentIdx(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', cursor: 'pointer',
                    borderBottom: i < recentFiles.length - 1 ? '1px solid var(--border)' : 'none',
                    background: hoveredRecentIdx === i ? 'var(--bg-hover)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>
                    {FORMAT_ICONS[entry.format as DocumentFormat] || '\u{1F4C4}'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.name}
                    </div>
                    <div style={{
                      fontSize: 10, color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {truncatePath(entry.path)}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatRelativeTime(entry.lastOpened)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Keyboard Shortcuts */}
        <div style={{
          marginTop: 36,
          width: '100%',
          maxWidth: 340,
          animation: 'satchel-fadeInUp 0.4s ease 0.3s both',
        }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 8,
            textAlign: 'center',
          }}>
            Keyboard Shortcuts
          </div>
          <div style={{
            background: 'var(--bg-surface)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            padding: '8px 14px',
          }}>
            {shortcuts.map((s) => (
              <ShortcutRow key={s.keys} keys={s.keys} desc={s.desc} />
            ))}
          </div>
        </div>

        {/* Bottom spacer */}
        <div style={{ height: 48, flexShrink: 0 }} />
      </div>
    </div>
  )
}
