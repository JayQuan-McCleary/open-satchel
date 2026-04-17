import { useEffect, useRef, useState } from 'react'
import { useFormatStore } from '../../stores/formatStore'
import type { FormatViewerProps } from '../types'
import type { PdfFormatState } from './index'

// Sidebar shows page thumbnails. Clicking a thumbnail scrolls the main
// viewer to that page. Thumbnails render at a low scale off the same
// pdfjs doc the viewer uses — no second parse needed.
export default function PdfSidebar({ tabId }: FormatViewerProps) {
  const state = useFormatStore(
    (s) => s.data[tabId] as PdfFormatState | undefined,
  )
  const ref = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!state?.doc || !ref.current) return
    const container = ref.current
    container.innerHTML = ''
    setError(null)

    const doc = state.doc as {
      numPages: number
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number }
        render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
      }>
    }

    let cancelled = false
    ;(async () => {
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale: 0.18 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.display = 'block'
          canvas.style.margin = '8px auto'
          canvas.style.background = 'white'
          canvas.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
          canvas.style.cursor = 'pointer'
          canvas.title = `Page ${i}`
          canvas.onclick = () => {
            const scrollTarget = document.querySelector<HTMLCanvasElement>(
              `canvas[data-page="${i}"]`,
            )
            scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }

          const wrap = document.createElement('div')
          wrap.style.textAlign = 'center'
          wrap.style.fontSize = '10px'
          wrap.style.color = 'var(--text-muted)'
          wrap.style.marginBottom = '8px'

          const label = document.createElement('div')
          label.textContent = String(i)
          wrap.appendChild(canvas)
          wrap.appendChild(label)
          container.appendChild(wrap)

          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          await page.render({ canvasContext: ctx, viewport }).promise
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [state?.doc])

  return (
    <div style={{ padding: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          padding: '4px 2px 8px',
        }}
      >
        Pages {state?.pageCount ? `(${state.pageCount})` : ''}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--danger)', padding: 6 }}>
          Thumbnail error: {error}
        </div>
      )}
      <div ref={ref} />
    </div>
  )
}
