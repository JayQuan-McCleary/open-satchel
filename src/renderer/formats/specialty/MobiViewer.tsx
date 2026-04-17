import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { MobiState } from './index'

export default function MobiViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as MobiState | undefined)
  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--bg-secondary)' }}>
      <div style={{ textAlign: 'center', maxWidth: 500 }}>
        <div style={{ fontSize: 48 }}>📖</div>
        <h2>{state.title || 'Kindle eBook'}</h2>
        {state.author && <p style={{ color: 'var(--text-muted)' }}>by {state.author}</p>}
        <p style={{ color: 'var(--text-muted)' }}>{(state.bytes.byteLength / 1024).toFixed(1)} KB</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Kindle formats (MOBI/AZW3) often contain DRM. For DRM-free content, convert to EPUB using Calibre.</p>
      </div>
    </div>
  )
}
