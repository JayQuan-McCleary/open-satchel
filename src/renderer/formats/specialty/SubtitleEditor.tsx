import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { SubtitleState } from './index'

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.floor((s * 1000) % 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function parseTime(str: string): number {
  const m = str.match(/(\d+):(\d+):(\d+)[.,](\d+)/)
  if (!m) return 0
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000
}

export default function SubtitleEditor({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as SubtitleState | undefined)
  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  const updateEntry = (i: number, updates: Partial<SubtitleState['entries'][0]>) => {
    useFormatStore.getState().updateFormatState<SubtitleState>(tabId, (p) => ({
      ...p,
      entries: p.entries.map((e, idx) => idx === i ? { ...e, ...updates } : e)
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 12 }}>
        {state.format.toUpperCase()} · {state.entries.length} entries
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {state.entries.map((e, i) => (
          <div key={i} style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', gap: 10 }}>
            <div style={{ width: 40, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{e.index}</div>
            <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input type="text" defaultValue={formatTime(e.start)} onBlur={(ev) => updateEntry(i, { start: parseTime(ev.target.value) })}
                style={{ fontSize: 11, fontFamily: 'monospace', padding: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              <input type="text" defaultValue={formatTime(e.end)} onBlur={(ev) => updateEntry(i, { end: parseTime(ev.target.value) })}
                style={{ fontSize: 11, fontFamily: 'monospace', padding: 3, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <textarea value={e.text} onChange={(ev) => updateEntry(i, { text: ev.target.value })}
              style={{ flex: 1, padding: 6, fontSize: 13, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical', minHeight: 50 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
