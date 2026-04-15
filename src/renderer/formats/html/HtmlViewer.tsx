import { useCallback } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { HtmlFormatState } from './index'

export default function HtmlViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as HtmlFormatState | undefined)

  const handleChange = useCallback((newContent: string) => {
    useFormatStore.getState().updateFormatState<HtmlFormatState>(tabId, (prev) => ({
      ...prev, content: newContent
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId])

  const toggleMode = useCallback(() => {
    useFormatStore.getState().updateFormatState<HtmlFormatState>(tabId, (prev) => ({
      ...prev,
      viewMode: prev.viewMode === 'split' ? 'source' : prev.viewMode === 'source' ? 'preview' : 'split'
    }))
  }, [tabId])

  if (!state) return <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>Loading...</div>

  const showSource = state.viewMode === 'split' || state.viewMode === 'source'
  const showPreview = state.viewMode === 'split' || state.viewMode === 'preview'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', padding: '4px 8px',
        background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', gap: 4
      }}>
        <button onClick={toggleMode} style={{
          padding: '2px 8px', fontSize: 11, borderRadius: 3,
          background: 'var(--bg-surface)', color: 'var(--text-secondary)'
        }}>
          {state.viewMode === 'split' ? '◧ Split' : state.viewMode === 'source' ? '💻 Source' : '👁 Preview'}
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {showSource && (
          <textarea
            value={state.content}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1, resize: 'none', background: 'var(--bg-secondary)',
              color: 'var(--text-primary)', border: 'none', outline: 'none',
              padding: '16px 20px',
              fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
              fontSize: 13, lineHeight: 1.6, tabSize: 2,
              borderRight: showPreview ? '1px solid var(--border)' : 'none'
            }}
          />
        )}
        {showPreview && (
          <iframe
            srcDoc={state.content}
            sandbox="allow-same-origin"
            style={{
              flex: 1, border: 'none', background: '#fff'
            }}
            title="HTML Preview"
          />
        )}
      </div>
    </div>
  )
}
