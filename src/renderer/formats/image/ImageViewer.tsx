import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useUIStore } from '../../stores/uiStore'
import type { ImageFormatState } from './index'

export default function ImageViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as ImageFormatState | undefined)
  const zoom = useUIStore((s) => s.zoom)

  if (!state) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={{
      overflow: 'auto', height: '100%', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-secondary)', padding: 20
    }}>
      <img
        src={state.dataUrl}
        style={{
          maxWidth: '100%', maxHeight: '100%',
          transform: `scale(${zoom})`, transformOrigin: 'center',
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)', borderRadius: 4
        }}
        draggable={false}
      />
    </div>
  )
}
