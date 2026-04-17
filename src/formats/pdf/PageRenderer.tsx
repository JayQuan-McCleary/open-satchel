import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useUIStore } from '../../stores/uiStore'
import { useFormatStore } from '../../stores/formatStore'
import type { PdfFormatState } from './index'
import FabricCanvas from './FabricCanvas'
import FormFieldRenderer from './FormFieldRenderer'
import EditableTextLayer from './EditableTextLayer'
import EditableParagraphLayer from './EditableParagraphLayer'
import { RulersGuides } from '../../components/editor/RulersGuides'

interface Props {
  tabId: string
  pdfDoc: PDFDocumentProxy
  pageIndex: number
  displayIndex: number
  rotation: number
}

export default function PageRenderer({
  tabId,
  pdfDoc,
  pageIndex,
  displayIndex,
  rotation
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoom = useUIStore((s) => s.zoom)
  const tool = useUIStore((s) => s.tool)
  const showRulers = useUIStore((s) => s.showRulers)
  const showGrid = useUIStore((s) => s.showGrid)
  const pdfBytes = useFormatStore((s) => (s.data[tabId] as PdfFormatState | undefined)?.pdfBytes)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  // pdfBytes isn't a direct dep of the render effect — we want the
  // effect to re-run when pdfDoc changes (which happens when pdfBytes
  // changes) but not separately. Touch it to silence the linter.
  void pdfBytes

  // Render loop with offscreen-canvas double-buffering. The visible
  // canvas keeps showing the previous render (pre-save) while pdfjs
  // rasterizes the new page into a detached canvas; when the async
  // render resolves, we blit the result onto the visible canvas in a
  // single frame. This eliminates the "fade to white" flash users saw
  // on Ctrl+S, because the visible canvas is never cleared.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false

    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1)
        if (cancelled) { page.cleanup(); return }

        const intrinsicRotation = (page as any).rotate || 0
        const effectiveRotation = (intrinsicRotation + rotation) % 360

        const viewport = page.getViewport({
          scale: zoom * window.devicePixelRatio,
          rotation: effectiveRotation,
        })
        const displayViewport = page.getViewport({
          scale: zoom,
          rotation: effectiveRotation,
        })

        // Render into an off-DOM canvas so the visible canvas doesn't
        // blank during the async pdfjs paint.
        const offscreen = document.createElement('canvas')
        offscreen.width = Math.floor(viewport.width)
        offscreen.height = Math.floor(viewport.height)
        const offCtx = offscreen.getContext('2d')!
        await page.render({ canvasContext: offCtx, viewport }).promise
        if (cancelled) { page.cleanup(); return }

        // Swap to visible canvas. Resizing the visible canvas clears
        // it, so we do that atomically with the drawImage that follows
        // — blank state is limited to microseconds inside the same JS
        // task, never visible to the user.
        canvas.width = offscreen.width
        canvas.height = offscreen.height
        canvas.style.width = `${displayViewport.width}px`
        canvas.style.height = `${displayViewport.height}px`
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(offscreen, 0, 0)

        setDimensions({ width: displayViewport.width, height: displayViewport.height })
        page.cleanup()
      } catch (err) {
        if (!cancelled) console.error('Failed to render page:', err)
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [pdfDoc, pageIndex, zoom, rotation])

  return (
    <div
      data-page-display-index={displayIndex}
      style={{
        position: 'relative',
        marginBottom: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        background: '#fff',
        // Use width/height from the rendered viewport so the container
        // always matches exactly the page content — no clipping, no excess space.
        width: dimensions ? `${dimensions.width}px` : 'auto',
        height: dimensions ? `${dimensions.height}px` : 'auto',
        flexShrink: 0
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          // No opacity transition — offscreen double-buffering above
          // means the visible canvas is never in an intermediate state.
        }}
      />
      {dimensions && pdfBytes && (
        <FormFieldRenderer
          tabId={tabId}
          pageIndex={pageIndex}
          pdfBytes={pdfBytes}
          zoom={zoom}
          pageWidth={dimensions.width}
          pageHeight={dimensions.height}
        />
      )}
      {dimensions && tool === 'edit_text' && (
        <EditableParagraphLayer
          tabId={tabId}
          pageIndex={pageIndex}
          pdfDoc={pdfDoc}
          width={dimensions.width}
          height={dimensions.height}
        />
      )}
      {/* Kept importable but not mounted by default — paragraph-level is
          the primary edit UI. Span-level remains as a manual-opt fallback
          for users who need TJ-element precision. */}
      {false && <EditableTextLayer tabId={tabId} pageIndex={pageIndex} pdfDoc={pdfDoc} width={0} height={0} />}
      {dimensions && tool !== 'edit_text' && (
        <FabricCanvas
          tabId={tabId}
          pageIndex={pageIndex}
          width={dimensions.width}
          height={dimensions.height}
          pdfDoc={pdfDoc}
        />
      )}
      {dimensions && (showRulers || showGrid) && (
        <RulersGuides
          fabricCanvas={null}
          width={dimensions.width}
          height={dimensions.height}
          showRulers={showRulers}
          showGrid={showGrid}
        />
      )}
    </div>
  )
}
