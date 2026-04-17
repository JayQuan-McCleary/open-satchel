import { useEffect, useState } from 'react'
import { recentApi, type RecentEntry } from '../../lib/ipc'
import { openFile, openFromPath } from '../../lib/actions'
import { FORMAT_ICONS, type DocumentFormat } from '../../types/tabs'

function formatRelativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

function truncatePath(path: string, maxLen = 60): string {
  if (path.length <= maxLen) return path
  const parts = path.split(/[/\\]/)
  if (parts.length <= 3) return path
  return `${parts[0]}${/[/\\]/.test(path.charAt(parts[0].length)) ? '\\' : ''}…\\${parts.slice(-2).join('\\')}`
}

export default function EmptyState() {
  const [recent, setRecent] = useState<RecentEntry[]>([])

  useEffect(() => {
    recentApi.get().then(setRecent).catch(() => {})
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        overflowY: 'auto',
        padding: '48px 24px',
      }}
    >
      <div style={{ maxWidth: 640, width: '100%' }}>
        <div
          style={{
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: -1.5,
            color: 'var(--text-primary)',
            lineHeight: 1.05,
            textAlign: 'center',
          }}
        >
          Open Satchel
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            marginTop: 8,
            fontWeight: 500,
            textAlign: 'center',
          }}
        >
          Free. Local. No email required.
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 6,
            textAlign: 'center',
          }}
        >
          Tauri + Rust rewrite · v0.1.0 · M1 scaffold
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 32 }}>
          <button
            onClick={() => void openFile()}
            style={{
              padding: '12px 22px',
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Open file
          </button>
        </div>

        {recent.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}
              >
                Recent files
              </span>
              <button
                onClick={async () => {
                  await recentApi.clear()
                  setRecent([])
                }}
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
            <div
              style={{
                background: 'var(--bg-surface)',
                borderRadius: 8,
                border: '1px solid var(--border)',
                overflow: 'hidden',
              }}
            >
              {recent.map((e, i) => (
                <div
                  key={e.path}
                  onClick={async () => {
                    try {
                      await openFromPath(e.path)
                    } catch {
                      const updated = await recentApi.remove(e.path)
                      setRecent(updated)
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: i < recent.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={(ev) => {
                    ;(ev.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(ev) => {
                    ;(ev.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  <span aria-hidden style={{ fontSize: 15 }}>
                    {FORMAT_ICONS[e.format as DocumentFormat] ?? '📄'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {truncatePath(e.path)}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {formatRelativeTime(e.last_opened)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 36,
            color: 'var(--text-muted)',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          <div>
            v1 supports PDF today. Markdown, Office, CSV, JSON, HTML, images land in M5–M6.
          </div>
        </div>
      </div>
    </div>
  )
}
