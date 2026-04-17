import { useState } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { EmailFormatState } from './index'

export default function EmailViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as EmailFormatState | undefined)
  const [filter, setFilter] = useState('')

  if (!state) return <div style={{ padding: 20 }}>Loading...</div>
  const active = state.messages[state.activeIndex]
  const filtered = filter ? state.messages.filter(m =>
    (m.subject || '').toLowerCase().includes(filter.toLowerCase()) ||
    (m.from || '').toLowerCase().includes(filter.toLowerCase())
  ) : state.messages

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-secondary)' }}>
      {state.type === 'mbox' && (
        <div style={{ width: 280, borderRight: '1px solid var(--border)', overflow: 'auto' }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)}
              style={{ width: '100%', padding: 4, fontSize: 11, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-primary)' }} />
          </div>
          {filtered.map((m, i) => {
            const idx = state.messages.indexOf(m)
            return (
              <div key={i} onClick={() => useFormatStore.getState().updateFormatState<EmailFormatState>(tabId, (p) => ({ ...p, activeIndex: idx }))}
                style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid var(--border)', background: state.activeIndex === idx ? 'var(--bg-surface)' : 'transparent' }}>
                <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject || '(no subject)'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.from}</div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {active && (
          <>
            <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>{active.subject || '(no subject)'}</h2>
              <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text-secondary)' }}>
                <div><strong>From:</strong> {active.from}</div>
                <div><strong>To:</strong> {active.to}</div>
                {active.cc && <div><strong>CC:</strong> {active.cc}</div>}
                {active.date && <div><strong>Date:</strong> {String(active.date)}</div>}
              </div>
              {active.attachments && active.attachments.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11 }}>
                  <strong>Attachments ({active.attachments.length}):</strong>{' '}
                  {active.attachments.map(a => `${a.name} (${a.size}b)`).join(', ')}
                </div>
              )}
            </div>
            {active.html ? (
              <div style={{ background: '#fff', color: '#000', padding: 16, borderRadius: 4 }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(active.html) }} />
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{active.text || '(empty body)'}</pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Minimal HTML sanitization — strip script/iframe tags
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
}
