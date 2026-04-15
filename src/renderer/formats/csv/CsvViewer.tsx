import { useCallback } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { CsvFormatState } from './index'

export default function CsvViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as CsvFormatState | undefined)

  const updateCell = useCallback((rowIdx: number, colIdx: number, value: string) => {
    useFormatStore.getState().updateFormatState<CsvFormatState>(tabId, (prev) => ({
      ...prev,
      rows: prev.rows.map((row, ri) =>
        ri === rowIdx ? row.map((cell, ci) => (ci === colIdx ? value : cell)) : row
      )
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId])

  const updateHeader = useCallback((colIdx: number, value: string) => {
    useFormatStore.getState().updateFormatState<CsvFormatState>(tabId, (prev) => ({
      ...prev,
      headers: prev.headers.map((h, i) => (i === colIdx ? value : h))
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId])

  if (!state) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ overflow: 'auto', height: '100%', width: '100%' }}>
      <table style={{
        borderCollapse: 'collapse', width: '100%',
        fontFamily: '"Cascadia Code", "Consolas", monospace', fontSize: 13
      }}>
        <thead>
          <tr>
            <th style={{
              padding: '6px 12px', background: 'var(--bg-surface)',
              borderBottom: '2px solid var(--accent)', color: 'var(--text-secondary)',
              fontSize: 10, textAlign: 'center', position: 'sticky', top: 0, zIndex: 1
            }}>
              #
            </th>
            {state.headers.map((header, i) => (
              <th key={i} style={{
                padding: 0, background: 'var(--bg-surface)',
                borderBottom: '2px solid var(--accent)',
                position: 'sticky', top: 0, zIndex: 1
              }}>
                <input
                  value={header}
                  onChange={(e) => updateHeader(i, e.target.value)}
                  style={{
                    width: '100%', padding: '6px 12px', border: 'none',
                    background: 'transparent', color: 'var(--text-primary)',
                    fontWeight: 600, fontFamily: 'inherit', fontSize: 'inherit'
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, ri) => (
            <tr key={ri}>
              <td style={{
                padding: '4px 8px', borderBottom: '1px solid var(--border)',
                color: 'var(--text-muted)', fontSize: 10, textAlign: 'center',
                background: 'var(--bg-secondary)'
              }}>
                {ri + 1}
              </td>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: 0, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                  <input
                    value={cell}
                    onChange={(e) => updateCell(ri, ci, e.target.value)}
                    style={{
                      width: '100%', padding: '4px 8px', border: 'none',
                      background: 'transparent', color: 'var(--text-primary)',
                      fontFamily: 'inherit', fontSize: 'inherit'
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
