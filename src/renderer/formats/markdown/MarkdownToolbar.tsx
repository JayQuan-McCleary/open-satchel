import { useCallback } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { MarkdownFormatState } from './index'

/**
 * ToolbarExtras for the Markdown format.
 * Rendered in the app's main toolbar area (outside the editor).
 * Shows view-mode toggle and document stats.
 */

const btnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 11,
  borderRadius: 3,
  background: 'var(--bg-surface)',
  color: 'var(--text-secondary)',
  border: '1px solid transparent',
  cursor: 'pointer',
  lineHeight: '18px',
}

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent)',
  color: '#1e1e2e',
}

export default function MarkdownToolbar({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as MarkdownFormatState | undefined)

  const setViewMode = useCallback(
    (mode: 'split' | 'edit' | 'preview') => {
      useFormatStore.getState().updateFormatState<MarkdownFormatState>(tabId, (prev) => ({
        ...prev,
        viewMode: mode,
      }))
    },
    [tabId]
  )

  if (!state) return null

  const charCount = state.content.length
  const lineCount = state.content.split('\n').length

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* View mode buttons */}
      <button
        style={state.viewMode === 'edit' ? activeBtnStyle : btnStyle}
        onClick={() => setViewMode('edit')}
        title="Edit only"
      >
        Edit
      </button>
      <button
        style={state.viewMode === 'split' ? activeBtnStyle : btnStyle}
        onClick={() => setViewMode('split')}
        title="Split view"
      >
        Split
      </button>
      <button
        style={state.viewMode === 'preview' ? activeBtnStyle : btnStyle}
        onClick={() => setViewMode('preview')}
        title="Preview only"
      >
        Preview
      </button>

      <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }} />

      {/* Stats */}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {lineCount} lines &middot; {charCount.toLocaleString()} chars
      </span>
    </div>
  )
}
