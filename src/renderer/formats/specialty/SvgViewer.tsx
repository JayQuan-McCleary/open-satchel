import { useState } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { SvgState } from './index'

export default function SvgViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as SvgState | undefined)
  const [mode, setMode] = useState<'preview' | 'source' | 'split'>('split')

  const handleChange = (newSvg: string) => {
    useFormatStore.getState().updateFormatState<SvgState>(tabId, (p) => ({ ...p, svg: newSvg }))
    useTabStore.getState().setTabDirty(tabId, true)
  }

  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
      <div style={{ padding: 6, borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
        <button onClick={() => setMode('preview')} style={{ padding: '4px 10px', fontSize: 12, background: mode === 'preview' ? 'var(--accent)' : 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 3, color: mode === 'preview' ? 'var(--bg-primary)' : 'var(--text-primary)' }}>Preview</button>
        <button onClick={() => setMode('split')} style={{ padding: '4px 10px', fontSize: 12, background: mode === 'split' ? 'var(--accent)' : 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 3, color: mode === 'split' ? 'var(--bg-primary)' : 'var(--text-primary)' }}>Split</button>
        <button onClick={() => setMode('source')} style={{ padding: '4px 10px', fontSize: 12, background: mode === 'source' ? 'var(--accent)' : 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 3, color: mode === 'source' ? 'var(--bg-primary)' : 'var(--text-primary)' }}>Source</button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {(mode === 'preview' || mode === 'split') && (
          <div style={{ flex: 1, overflow: 'auto', padding: 20, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: mode === 'split' ? '1px solid var(--border)' : 'none' }}>
            <div dangerouslySetInnerHTML={{ __html: state.svg }} style={{ maxWidth: '100%', maxHeight: '100%' }} />
          </div>
        )}
        {(mode === 'source' || mode === 'split') && (
          <textarea value={state.svg} onChange={(e) => handleChange(e.target.value)} spellCheck={false}
            style={{ flex: 1, resize: 'none', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: 'none', outline: 'none', padding: 12, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre', overflowWrap: 'normal' }} />
        )}
      </div>
    </div>
  )
}
