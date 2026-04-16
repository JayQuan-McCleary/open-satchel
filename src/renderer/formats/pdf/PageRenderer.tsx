import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useUIStore } from '../../stores/uiStore'
import { useFormatStore } from '../../stores/formatStore'
import type { PdfFormatState } from './index'
import FabricCanvas from './FabricCanvas'
import FormFieldRenderer from './FormFieldRenderer'
import EditableTextLayer from './EditableTextLayer'
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
  const hasPendingEdits = useFormatStore((s) => {
    const state = s.data[tabId] as PdfFormatState | undefined
    const page = state?.pages.find(p => p.pageIndex === pageIndex) as any
    return !!page?._textLayerEdits?.length
  })
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [canvasReady, setCanvasReady] = useState(true)

  // When pdfBytes change, mark canvas as not ready until re-render completes
  useEffect(() => { setCanvasReady(false) }, [pdfBytes])

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
          rotation: effectiveRotation
        })
        const displayViewport = page.getViewport({ scale: zoom, rotation: effectiveRotation })

        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${displayViewport.width}px`
        canvas.style.height = `${displayViewport.height}px`

        setDimensions({ width: displayViewport.width, height: displayViewport.height })

        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport }).promise
        if (!cancelled) setCanvasReady(true)
        page.cleanup()
      } catch (err) {
        if (!cancelled) console.error('Failed to render page:', err)
      }
    }

    render()
    return () => { cancelled = true }
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
          opacity: (hasPendingEdits || !canvasReady) ? 0 : 1,
          transition: 'opacity 0.2s'
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
        <EditableTextLayer
          tabId={tabId}
          pageIndex={pageIndex}
          pdfDoc={pdfDoc}
          width={dimensions.width}
          height={dimensions.height}
        />
      )}
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
