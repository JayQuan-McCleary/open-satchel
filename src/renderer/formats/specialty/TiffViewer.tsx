import { useEffect, useRef } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { TiffState } from './index'

export default function TiffViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as TiffState | undefined)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!state || !canvasRef.current) return
    const page = state.pages[state.activePage]
    if (!page) return
    const canvas = canvasRef.current
    canvas.width = page.width
    canvas.height = page.height
    canvas.getContext('2d')?.putImageData(page, 0, 0)
  }, [state])

  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 12 }}>
        TIFF · {state.pages.length} page(s) · Page {state.activePage + 1}
        {state.pages.length > 1 && (
          <span style={{ marginLeft: 12 }}>
            {state.pages.map((_, i) => (
              <button key={i} onClick={() => useFormatStore.getState().updateFormatState<TiffState>(tabId, p => ({ ...p, activePage: i }))}
                style={{ padding: '2px 8px', marginRight: 3, background: state.activePage === i ? 'var(--accent)' : 'var(--bg-surface)', color: state.activePage === i ? 'var(--bg-primary)' : 'var(--text-primary)', border: '1px solid var(--border)', fontSize: 11 }}>
                {i + 1}
              </button>
            ))}
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
      </div>
    </div>
  )
}
