import { useCallback } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { XlsxFormatState } from './index'

const btnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 11,
  borderRadius: 3,
  background: 'var(--bg-surface)',
  color: 'var(--text-secondary)',
  border: '1px solid transparent',
  cursor: 'pointer',
  lineHeight: '18px',
  minWidth: 24,
  textAlign: 'center'
}

const sepStyle: React.CSSProperties = {
  width: 1,
  height: 14,
  background: 'var(--border)',
  margin: '0 4px'
}

export default function XlsxToolbar({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as XlsxFormatState | undefined)

  const updateState = useCallback(
    (updater: (prev: XlsxFormatState) => XlsxFormatState) => {
      useFormatStore.getState().updateFormatState<XlsxFormatState>(tabId, updater)
    },
    [tabId]
  )

  const markDirty = useCallback(() => {
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId])

  const addSheet = useCallback(() => {
    updateState((prev) => {
      const minCols = 26
      const minRows = 50
      const newName = `Sheet${prev.sheets.length + 1}`
      const sheets = [
        ...prev.sheets,
        {
          name: newName,
          data: Array.from({ length: minRows }, () => new Array(minCols).fill('')),
          colWidths: new Array(minCols).fill(80)
        }
      ]
      return {
        ...prev,
        sheets,
        activeSheet: sheets.length - 1,
        selectedCell: { row: 0, col: 0 },
        editingCell: null
      }
    })
    markDirty()
  }, [updateState, markDirty])

  const deleteSheet = useCallback(() => {
    updateState((prev) => {
      if (prev.sheets.length <= 1) return prev
      const sheets = prev.sheets.filter((_, i) => i !== prev.activeSheet)
      const activeSheet = Math.min(prev.activeSheet, sheets.length - 1)
      return { ...prev, sheets, activeSheet, selectedCell: { row: 0, col: 0 }, editingCell: null }
    })
    markDirty()
  }, [updateState, markDirty])

  if (!state) return null

  const sheet = state.sheets[state.activeSheet]
  const totalRows = sheet?.data.length ?? 0
  const totalCols = sheet?.colWidths.length ?? 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      {/* Text formatting (visual display only) */}
      <button style={{ ...btnStyle, fontWeight: 700 }} title="Bold">
        B
      </button>
      <button style={{ ...btnStyle, fontStyle: 'italic' }} title="Italic">
        I
      </button>
      <button style={{ ...btnStyle, textDecoration: 'underline' }} title="Underline">
        U
      </button>

      <div style={sepStyle} />

      {/* Alignment */}
      <button style={btnStyle} title="Align left">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="1" y="2" width="10" height="1.5" rx="0.5" />
          <rect x="1" y="5" width="7" height="1.5" rx="0.5" />
          <rect x="1" y="8" width="10" height="1.5" rx="0.5" />
        </svg>
      </button>
      <button style={btnStyle} title="Align center">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="1" y="2" width="10" height="1.5" rx="0.5" />
          <rect x="2.5" y="5" width="7" height="1.5" rx="0.5" />
          <rect x="1" y="8" width="10" height="1.5" rx="0.5" />
        </svg>
      </button>
      <button style={btnStyle} title="Align right">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect x="1" y="2" width="10" height="1.5" rx="0.5" />
          <rect x="4" y="5" width="7" height="1.5" rx="0.5" />
          <rect x="1" y="8" width="10" height="1.5" rx="0.5" />
        </svg>
      </button>

      <div style={sepStyle} />

      {/* Cell background color */}
      <button style={btnStyle} title="Cell background color">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="1" width="10" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <rect x="1" y="9.5" width="10" height="2" rx="0.5" fill="var(--accent)" />
        </svg>
      </button>

      <div style={sepStyle} />

      {/* Number format */}
      <select
        style={{
          padding: '1px 4px',
          fontSize: 11,
          borderRadius: 3,
          background: 'var(--bg-surface)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          outline: 'none'
        }}
        title="Number format"
        defaultValue="general"
      >
        <option value="general">General</option>
        <option value="number">Number</option>
        <option value="currency">Currency</option>
        <option value="percentage">Percentage</option>
        <option value="date">Date</option>
      </select>

      <div style={sepStyle} />

      {/* Sheet management */}
      <button style={btnStyle} onClick={addSheet} title="Add sheet">
        + Sheet
      </button>
      <button
        style={{
          ...btnStyle,
          color: state.sheets.length <= 1 ? 'var(--text-muted)' : 'var(--text-secondary)'
        }}
        onClick={deleteSheet}
        disabled={state.sheets.length <= 1}
        title="Delete current sheet"
      >
        - Sheet
      </button>

      <div style={sepStyle} />

      {/* Info */}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {totalRows} rows &middot; {totalCols} cols &middot; {state.sheets.length} sheet{state.sheets.length !== 1 ? 's' : ''}
      </span>
    </div>
  )
}
