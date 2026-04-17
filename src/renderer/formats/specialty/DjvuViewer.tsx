import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { DjvuState } from './index'

export default function DjvuViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as DjvuState | undefined)
  if (!state) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--bg-secondary)' }}>
      <div style={{ textAlign: 'center', maxWidth: 500 }}>
        <div style={{ fontSize: 48 }}>📄</div>
        <h2>DjVu Document</h2>
        <p style={{ color: 'var(--text-muted)' }}>{(state.bytes.byteLength / 1024).toFixed(1)} KB</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>DjVu rendering is limited. Convert to PDF for full viewing, or open in a dedicated DjVu viewer.</p>
      </div>
    </div>
  )
}
