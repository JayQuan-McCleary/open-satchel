import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { HeicState } from './index'

export default function HeicViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as HeicState | undefined)
  if (!state) return <div style={{ padding: 20 }}>Loading HEIC...</div>
  if (!state.dataUrl) return <div style={{ padding: 20, color: 'var(--danger)' }}>Could not decode HEIC. The file may be corrupt or an unsupported variant.</div>

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--bg-secondary)' }}>
      <img src={state.dataUrl} style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
    </div>
  )
}
