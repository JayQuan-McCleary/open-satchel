import { useState } from 'react'

interface Props {
  onClose: () => void
  onApply: (text: string, options: WatermarkOptions) => void
}

export interface WatermarkOptions {
  fontSize: number
  color: string
  opacity: number
  angle: number
  position: 'center' | 'diagonal'
}

export default function WatermarkDialog({ onClose, onApply }: Props) {
  const [text, setText] = useState('CONFIDENTIAL')
  const [fontSize, setFontSize] = useState(48)
  const [color, setColor] = useState('#888888')
  const [opacity, setOpacity] = useState(0.3)
  const [angle, setAngle] = useState(-45)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 8, padding: 24,
        border: '1px solid var(--border)', minWidth: 380
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Add Watermark</h3>
          <button onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Text</label>
            <input value={text} onChange={(e) => setText(e.target.value)}
              style={{ width: '100%', padding: '6px 8px' }} />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Font Size</label>
              <input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}
                min={12} max={120} style={{ width: '100%', padding: '6px 8px' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Color</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                style={{ width: 40, height: 32, border: 'none', cursor: 'pointer' }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Opacity: {Math.round(opacity * 100)}%
            </label>
            <input type="range" min={5} max={100} value={Math.round(opacity * 100)}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Angle: {angle}°
            </label>
            <input type="range" min={-90} max={90} value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>

          {/* Preview */}
          <div style={{
            height: 80, background: '#fff', borderRadius: 4, display: 'flex',
            alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
          }}>
            <span style={{
              fontSize: Math.min(fontSize * 0.4, 28), color, opacity,
              fontWeight: 'bold', fontFamily: 'Impact, sans-serif',
              transform: `rotate(${angle}deg)`, userSelect: 'none'
            }}>
              {text}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'var(--bg-surface)', borderRadius: 4 }}>
            Cancel
          </button>
          <button
            onClick={() => onApply(text, { fontSize, color, opacity, angle, position: 'center' })}
            style={{ padding: '8px 16px', background: 'var(--accent)', color: 'var(--bg-primary)', borderRadius: 4, fontWeight: 600 }}
          >
            Apply to All Pages
          </button>
        </div>
      </div>
    </div>
  )
}
