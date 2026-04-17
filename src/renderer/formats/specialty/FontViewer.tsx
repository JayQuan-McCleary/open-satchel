import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import type { FontState } from './index'

export default function FontViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as FontState | undefined)
  if (!state) return <div style={{ padding: 20 }}>Loading...</div>
  if (state.error) return <div style={{ padding: 20, color: 'var(--danger)' }}>Error: {state.error}</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-secondary)', padding: 20 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ marginTop: 0 }}>{state.name || state.familyName}</h2>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          <div>Family: {state.familyName} · Style: {state.style} · Weight: {state.weight}</div>
          <div>{state.glyphCount} glyphs · {state.unitsPerEm} units/em</div>
        </div>
        {state.sampleSvgs && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
            {state.sampleSvgs.map(({ char, svg }) => (
              <div key={char} style={{ background: '#fff', padding: 10, borderRadius: 4, textAlign: 'center', aspectRatio: '1' }}>
                <div style={{ width: '100%', height: 60 }} dangerouslySetInnerHTML={{ __html: svg }} />
                <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>{char}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
