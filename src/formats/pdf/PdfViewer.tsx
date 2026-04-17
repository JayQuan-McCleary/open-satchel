import { useEffect, useRef, useState } from 'react'
import { useFormatStore } from '../../stores/formatStore'
import type { FormatViewerProps } from '../types'
import type { PdfFormatState } from './index'

// M1 viewer: render all pages stacked vertically, fixed scale. No editing
// layer, no text selection, no thumbnail click-scroll (that's the sidebar's
// job). Goal here is to prove the IPC + pdfjs pipeline end-to-end.
export default function PdfViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore(
    (s) => s.data[tabId] as PdfFormatState | undefined,
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (!state?.doc || !containerRef.current) return
    const container = containerRef.current
    container.innerHTML = ''
    setRenderError(null)

    // Render synchronously-sequentially so large PDFs stream in rather
    // than spiking all at once.
    let cancelled = false
    const doc = state.doc as {
      numPages: number
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number }
        render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
      }>
    }

    ;(async () => {
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale: state.scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.display = 'block'
          canvas.style.margin = '12px auto'
          canvas.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)'
          canvas.style.background = 'white'
          canvas.setAttribute('data-page', String(i))

          const wrap = document.createElement('div')
          wrap.style.position = 'relative'
          wrap.appendChild(canvas)
          container.appendChild(wrap)

          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          await page.render({ canvasContext: ctx, viewport }).promise
        }
      } catch (err) {
        if (!cancelled) setRenderError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [state?.doc, state?.scale])

  if (!state) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: 12,
        }}
      >
        Loading PDF…
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        background: 'var(--bg-secondary)',
        position: 'relative',
      }}
    >
      {renderError && (
        <div
          style={{
            margin: 16,
            padding: 12,
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            fontSize: 12,
            borderRadius: 6,
          }}
        >
          Render error: {renderError}
        </div>
      )}
      <div ref={containerRef} className="pdfjs-container" />
    </div>
  )
}
