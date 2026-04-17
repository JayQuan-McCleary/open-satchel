import { useState } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { SqliteState } from './index'

export default function SqliteViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as SqliteState | undefined)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ columns: string[]; rows: any[][] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runQuery = async (sql: string) => {
    if (!state) return
    try {
      const initSqlJs = (await import('sql.js')).default
      const SQL = await initSqlJs({ locateFile: (f: string) => `/${f}` })
      const db = new SQL.Database(state.bytes)
      const res = db.exec(sql)
      db.close()
      if (res[0]) {
        setResult({ columns: res[0].columns, rows: res[0].values })
        setError(null)
      } else {
        setResult({ columns: [], rows: [] })
      }
    } catch (err) {
      setError((err as Error).message)
      setResult(null)
    }
  }

  if (!state) return <div style={{ padding: 20 }}>Loading...</div>
  if (state.error) return <div style={{ padding: 20, color: 'var(--danger)' }}>Error: {state.error}</div>

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-secondary)' }}>
      <div style={{ width: 220, borderRight: '1px solid var(--border)', overflow: 'auto' }}>
        <div style={{ padding: 8, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tables ({state.tables.length})</div>
        {state.tables.map((t) => (
          <div key={t.name} onClick={() => { setQuery(`SELECT * FROM "${t.name}" LIMIT 100`); runQuery(`SELECT * FROM "${t.name}" LIMIT 100`) }}
            style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
            🗂 {t.name} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({t.rowCount})</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: 8, borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <textarea value={query} onChange={e => setQuery(e.target.value)} placeholder="SELECT * FROM table_name LIMIT 100"
            style={{ flex: 1, padding: 6, fontSize: 12, fontFamily: 'monospace', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-primary)', minHeight: 40, resize: 'vertical' }} />
          <button onClick={() => runQuery(query)} style={{ padding: '6px 16px', background: 'var(--accent)', color: 'var(--bg-primary)', border: 'none', borderRadius: 3, fontSize: 12, cursor: 'pointer' }}>Run</button>
        </div>
        {error && <div style={{ padding: 8, color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
        {result && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg-primary)', position: 'sticky', top: 0 }}>
                {result.columns.map((c, i) => <th key={i} style={{ padding: 6, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{c}</th>)}
              </tr></thead>
              <tbody>{result.rows.slice(0, 500).map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                  {row.map((v, ci) => <td key={ci} style={{ padding: 6, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v === null ? <em style={{ color: 'var(--text-muted)' }}>null</em> : String(v)}</td>)}
                </tr>
              ))}</tbody>
            </table>
            {result.rows.length > 500 && <div style={{ padding: 8, fontSize: 11, color: 'var(--text-muted)' }}>Showing first 500 of {result.rows.length} rows</div>}
          </div>
        )}
      </div>
    </div>
  )
}
