// Rulers, guides, grid, snap. Overlays on top of the PDF viewer.
// Purely visual — guides are not serialized into the PDF. Snap-to-
// grid affects only interactive object placement/drag via Fabric's
// internal handling (we set `snapAngle` / `snapThreshold`).

import { useEffect, useRef } from 'react'
import type { Canvas } from 'fabric'

export interface RulersGuidesProps {
  fabricCanvas: Canvas | null
  width: number
  height: number
  showRulers: boolean
  showGrid: boolean
  gridSize?: number   // pt
  snapToGrid?: boolean
  guides?: Array<{ axis: 'h' | 'v'; pos: number }>
  onAddGuide?: (axis: 'h' | 'v', pos: number) => void
}

export function RulersGuides({ fabricCanvas, width, height, showRulers, showGrid, gridSize = 50, snapToGrid = false, guides = [], onAddGuide }: RulersGuidesProps) {
  const gridRef = useRef<HTMLCanvasElement>(null)
  const rulerHRef = useRef<HTMLCanvasElement>(null)
  const rulerVRef = useRef<HTMLCanvasElement>(null)

  // Draw grid
  useEffect(() => {
    const c = gridRef.current
    if (!c || !showGrid) return
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = 'rgba(137,180,250,0.15)'
    ctx.lineWidth = 1
    for (let x = gridSize; x < width; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); ctx.stroke()
    }
    for (let y = gridSize; y < height; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke()
    }
  }, [showGrid, gridSize, width, height])

  // Draw rulers
  useEffect(() => {
    if (!showRulers) return
    const drawH = () => {
      const c = rulerHRef.current
      if (!c) return
      c.width = width
      c.height = 20
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#313244'
      ctx.fillRect(0, 0, width, 20)
      ctx.strokeStyle = '#a6adc8'
      ctx.fillStyle = '#cdd6f4'
      ctx.font = '9px sans-serif'
      for (let x = 0; x < width; x += 10) {
        const len = x % 50 === 0 ? 10 : x % 25 === 0 ? 7 : 4
        ctx.beginPath(); ctx.moveTo(x + 0.5, 20); ctx.lineTo(x + 0.5, 20 - len); ctx.stroke()
        if (x % 50 === 0 && x > 0) ctx.fillText(String(x), x + 2, 10)
      }
    }
    const drawV = () => {
      const c = rulerVRef.current
      if (!c) return
      c.width = 20
      c.height = height
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#313244'
      ctx.fillRect(0, 0, 20, height)
      ctx.strokeStyle = '#a6adc8'
      ctx.fillStyle = '#cdd6f4'
      ctx.font = '9px sans-serif'
      for (let y = 0; y < height; y += 10) {
        const len = y % 50 === 0 ? 10 : y % 25 === 0 ? 7 : 4
        ctx.beginPath(); ctx.moveTo(20, y + 0.5); ctx.lineTo(20 - len, y + 0.5); ctx.stroke()
        if (y % 50 === 0 && y > 0) { ctx.save(); ctx.translate(10, y + 12); ctx.rotate(-Math.PI / 2); ctx.fillText(String(y), 0, 4); ctx.restore() }
      }
    }
    drawH(); drawV()
  }, [showRulers, width, height])

  // Snap to grid on object move
  useEffect(() => {
    if (!fabricCanvas || !snapToGrid) return
    const handler = (e: { target?: { left?: number; top?: number; set?: (opts: object) => void } }) => {
      if (!e.target || typeof e.target.set !== 'function') return
      const lx = Math.round((e.target.left ?? 0) / gridSize) * gridSize
      const ly = Math.round((e.target.top ?? 0) / gridSize) * gridSize
      e.target.set({ left: lx, top: ly })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(fabricCanvas as any).on('object:moving', handler)
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(fabricCanvas as any).off('object:moving', handler)
    }
  }, [fabricCanvas, snapToGrid, gridSize])

  const handleRulerClick = (axis: 'h' | 'v') => (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onAddGuide) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = axis === 'h' ? e.clientX - rect.left : e.clientY - rect.top
    onAddGuide(axis, pos)
  }

  return (
    <>
      {showGrid && (
        <canvas
          ref={gridRef}
          style={{ position: 'absolute', top: 0, left: 0, width, height, pointerEvents: 'none', zIndex: 2 }}
        />
      )}
      {showRulers && (
        <>
          <canvas
            ref={rulerHRef}
            onClick={handleRulerClick('v')}
            style={{ position: 'absolute', top: -20, left: 0, width, height: 20, zIndex: 3, cursor: 'crosshair' }}
            title="Click to add vertical guide"
          />
          <canvas
            ref={rulerVRef}
            onClick={handleRulerClick('h')}
            style={{ position: 'absolute', top: 0, left: -20, width: 20, height, zIndex: 3, cursor: 'crosshair' }}
            title="Click to add horizontal guide"
          />
        </>
      )}
      {guides.map((g, i) => (
        <div key={i} style={{
          position: 'absolute',
          background: 'rgba(243, 139, 168, 0.6)',
          zIndex: 2,
          pointerEvents: 'none',
          ...(g.axis === 'v'
            ? { top: 0, left: g.pos, width: 1, height }
            : { left: 0, top: g.pos, height: 1, width }),
        }} />
      ))}
    </>
  )
}
