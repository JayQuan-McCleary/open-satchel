import { useState, useMemo } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { ArchiveFormatState, ArchiveEntry } from './index'

export default function ArchiveViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as ArchiveFormatState | undefined)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')

  const filtered = useMemo(() => {
    if (!state?.entries) return []
    const needle = filter.toLowerCase()
    return state.entries.filter(e => !filter || e.path.toLowerCase().includes(needle))
  }, [state?.entries, filter])

  const extract = async (entry: ArchiveEntry) => {
    if (entry.isDirectory || !state) return
    if (state.archiveType === 'zip') {
      try {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(state.bytes)
        const file = zip.file(entry.path)
        if (!file) return
        // Try to read as text
        const text = await file.async('string')
        const printable = text.slice(0, 2000)
        setPreview(printable)
        setSelected(entry.path)
      } catch (err) {
        setPreview('[Binary or unreadable file]')
      }
    }
  }

  const download = async (entry: ArchiveEntry) => {
    if (!state) return
    if (state.archiveType === 'zip') {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(state.bytes)
      const file = zip.file(entry.path)
      if (!file) return
      const bytes = await file.async('uint8array')
      await window.api.file.saveAs(bytes)
    }
  }

  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{state.filename}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {state.archiveType.toUpperCase()} · {state.entries.length} entries · {(state.bytes.byteLength / 1024).toFixed(1)} KB
        </span>
        <input placeholder="Filter files..." value={filter} onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', fontSize: 12, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-primary)' }} />
      </div>

      {state.error && (
        <div style={{ padding: 8, background: 'rgba(243,139,168,0.1)', color: 'var(--danger)', fontSize: 11 }}>
          {state.error}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'auto', borderRight: '1px solid var(--border)' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-primary)' }}>
              <th style={{ textAlign: 'left', padding: 6 }}>Path</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Size</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Packed</th>
              <th style={{ padding: 6 }}></th>
            </tr></thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr key={i} onClick={() => extract(entry)}
                  style={{ cursor: 'pointer', background: selected === entry.path ? 'var(--bg-surface)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>
                    {entry.isDirectory ? '📁 ' : '📄 '}{entry.path}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', color: 'var(--text-muted)' }}>{entry.size.toLocaleString()}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: 'var(--text-muted)' }}>{entry.compressedSize.toLocaleString()}</td>
                  <td style={{ padding: 6 }}>
                    {!entry.isDirectory && <button style={{ fontSize: 10, padding: '2px 6px' }} onClick={(e) => { e.stopPropagation(); download(entry) }}>Save</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {preview && (
          <div style={{ flex: 1, padding: 12, overflow: 'auto' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Preview: {selected}</div>
            <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{preview}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
