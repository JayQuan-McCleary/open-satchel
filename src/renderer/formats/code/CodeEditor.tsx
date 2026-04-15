import { useEffect, useRef, useCallback } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { CodeFormatState } from './index'

export default function CodeEditor({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as CodeFormatState | undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = useCallback((newContent: string) => {
    useFormatStore.getState().updateFormatState<CodeFormatState>(tabId, (prev) => ({
      ...prev,
      content: newContent
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId])

  if (!state) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      <textarea
        ref={textareaRef}
        value={state.content}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          height: '100%',
          resize: 'none',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: 'none',
          outline: 'none',
          padding: '16px 20px',
          fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
          fontSize: 14,
          lineHeight: 1.6,
          tabSize: 2,
          whiteSpace: 'pre',
          overflowWrap: 'normal',
          overflowX: 'auto'
        }}
        onKeyDown={(e) => {
          // Tab key inserts spaces instead of changing focus
          if (e.key === 'Tab') {
            e.preventDefault()
            const ta = e.target as HTMLTextAreaElement
            const start = ta.selectionStart
            const end = ta.selectionEnd
            const newVal = state.content.substring(0, start) + '  ' + state.content.substring(end)
            handleChange(newVal)
            // Restore cursor position after React re-render
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + 2
            })
          }
        }}
      />
    </div>
  )
}
