import { useEffect, useRef, useCallback, useState } from 'react'
import { Canvas as FabricCanvasClass } from 'fabric'
import { useUIStore } from '../../stores/uiStore'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import type { PdfFormatState } from './index'
import { applySelectTool } from '../../components/editor/SelectTool'
import { applyTextTool } from '../../components/editor/TextTool'
import { applyDrawTool } from '../../components/editor/DrawTool'
import { applyImageTool } from '../../components/editor/ImageTool'
import { applyHighlightTool } from '../../components/editor/HighlightTool'
import { applyShapeTool } from '../../components/editor/ShapeTool'
import { applyStickyNoteTool } from '../../components/editor/StickyNoteTool'
import { applyStampTool, STAMPS } from '../../components/editor/StampTool'
import { placeSignature } from '../../components/editor/SignatureTool'
import SignatureDialog from '../../components/signature/SignatureDialog'
import {
  applyWipeOffTool, applyHighlightAreaTool, applyTextBoxAnnotationTool,
  applyLinkAnnotationTool, applyAudioAnnotationTool, applyVideoAnnotationTool,
  applyInsertTextMarkerTool, applyReplaceTextMarkerTool,
} from '../../components/editor/CanvasTools'
import { applyMeasureTool } from '../../components/editor/MeasureTool'
import { applyFormDesignerTool } from '../../components/editor/FormDesignerTool'
import {
  applyFillCrossTool, applyFillCheckTool, applyFillCircleTool,
  applyFillLineTool, applyFillDotTool, applyFillDateTool,
  applyFillInitialsTool, applyFillTimestampTool,
} from '../../components/editor/FillSignTools'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { shouldAutoRevertAfterDrop } from './clickDispatcher'

interface Props {
  tabId: string
  pageIndex: number
  width: number
  height: number
  pdfDoc?: PDFDocumentProxy | null
  /** When false, annotations are drawn (so things added via Add Text /
   *  Draw / Highlight don't vanish) but the canvas doesn't capture any
   *  pointer events — clicks fall through to whatever layer is on top
   *  (e.g. the paragraph editor). Used when Edit Text is active. */
  interactive?: boolean
}

export default function FabricCanvas({ tabId, pageIndex, width, height, pdfDoc, interactive = true }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<FabricCanvasClass | null>(null)
  // Track custom event handlers so we only remove ours, not Fabric's internal ones
  const handlersRef = useRef<{
    mouseDown?: (...args: any[]) => void
    mouseMove?: (...args: any[]) => void
    mouseUp?: (...args: any[]) => void
  }>({})

  // Signature feature: where on this page the user clicked while the
  // Signature tool was active. Drives the SignatureDialog; null = closed.
  const [signaturePos, setSignaturePos] = useState<{ x: number; y: number } | null>(null)

  const tool = useUIStore((s) => s.tool)
  const drawingOptions = useUIStore((s) => s.drawingOptions)
  const textOptions = useUIStore((s) => s.textOptions)
  const highlightColor = useUIStore((s) => s.highlightColor)
  const shapeColor = useUIStore((s) => s.shapeColor)
  const shapeStrokeWidth = useUIStore((s) => s.shapeStrokeWidth)
  const noteColor = useUIStore((s) => s.noteColor)
  const selectedStamp = useUIStore((s) => s.selectedStamp)

  const fabricJSON = useFormatStore((s) => {
    const state = s.data[tabId] as PdfFormatState | undefined
    const page = state?.pages.find((p) => p.pageIndex === pageIndex)
    return page?.fabricJSON ?? null
  })

  // Custom properties to preserve when serializing Fabric objects to JSON.
  // These are used by various tools (edit text, form designer, etc.)
  const CUSTOM_PROPS = [
    '__editTextBlock', '__originalText', '__operatorIndices', '__originalTextRuns',
    '__pdfBounds', '__blockFontName', '__blockFontSize',
    '__customFontId', '__fieldType', '__fieldName',
  ]

  const saveState = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    // Fabric v6 typed toJSON() with no args; custom-props form still works.
    const json = (fc.toJSON as (p?: string[]) => Record<string, unknown>)(CUSTOM_PROPS)
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.pageIndex === pageIndex ? { ...p, fabricJSON: json } : p
      )
    }))
    useTabStore.getState().setTabDirty(tabId, true)
  }, [tabId, pageIndex])

  // Remove only our custom handlers, not Fabric's internal ones
  const removeCustomHandlers = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    const h = handlersRef.current
    if (h.mouseDown) { fc.off('mouse:down', h.mouseDown); h.mouseDown = undefined }
    if (h.mouseMove) { fc.off('mouse:move', h.mouseMove); h.mouseMove = undefined }
    if (h.mouseUp) { fc.off('mouse:up', h.mouseUp); h.mouseUp = undefined }
  }, [])

  // Initialize fabric canvas
  useEffect(() => {
    const el = canvasRef.current
    if (!el || fabricRef.current) return

    const fc = new FabricCanvasClass(el, {
      width,
      height,
      selection: true,
      preserveObjectStacking: true
    })

    if (fabricJSON) {
      fc.loadFromJSON(fabricJSON).then(() => fc.renderAll())
    }

    fc.on('object:added', saveState)
    fc.on('object:modified', saveState)
    fc.on('object:removed', saveState)

    // Phase B of docs/MODELESS.md: after a drop-on-click action tool
    // commits its object, flip back to Select. Matches Word / Docs /
    // Notion / Canva UX where action tools are one-shot. Drag-to-
    // create tools (draw, highlight, shape, measure) keep their tool
    // active so the user can repeat — Acrobat-style.
    //
    // Defer the setTool by one tick so Fabric finishes its own
    // post-add housekeeping (like entering text-edit mode on a new
    // Textbox) before the tool swap.
    fc.on('object:added', () => {
      const currentTool = useUIStore.getState().tool
      if (!shouldAutoRevertAfterDrop(currentTool)) return
      setTimeout(() => {
        // Re-check the tool in case the user already changed it.
        if (useUIStore.getState().tool === currentTool) {
          useUIStore.getState().setTool('select')
        }
      }, 30)
    })

    fabricRef.current = fc

    return () => {
      saveState()
      fc.dispose()
      fabricRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update dimensions
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return
    fc.setDimensions({ width, height })
  }, [width, height])

  // Live styling: when ribbon text options change while a Textbox is
  // selected, apply them to that object so users can format existing text.
  // Without this, ribbon clicks only affect the NEXT textbox placed.
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return
    const targets = fc.getActiveObjects().filter((o) => o.type === 'Textbox' || o.type === 'textbox')
    if (targets.length === 0) return
    for (const t of targets) {
      t.set({
        fontWeight: textOptions.bold ? 'bold' : 'normal',
        fontStyle: textOptions.italic ? 'italic' : 'normal',
        underline: !!textOptions.underline,
        linethrough: !!textOptions.strikethrough,
        fontFamily: textOptions.fontFamily,
        fontSize: textOptions.fontSize,
        fill: textOptions.color,
        textAlign: textOptions.textAlign,
        lineHeight: textOptions.lineHeight,
        charSpacing: textOptions.charSpacing ?? 0,
      })
    }
    fc.renderAll()
    saveState()
  }, [textOptions, saveState])

  // Delete / Backspace handler.
  //
  // Two edge cases this has to respect:
  //  1. A Fabric Textbox in editing mode uses a HIDDEN TEXTAREA (not
  //     contenteditable). `isContentEditable` is false on it, so the
  //     previous guard let Backspace delete the whole object while the
  //     user was trying to erase a character.
  //  2. Native form inputs / textareas on the page should also own their
  //     own Backspace.
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      const isEditable =
        !!t && (
          t.isContentEditable ||
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA'
        )
      // Also check Fabric's own "is this Textbox currently editing?"
      const activeObj = fc.getActiveObject() as unknown as { isEditing?: boolean; type?: string } | null
      const fabricEditing = !!activeObj && activeObj.isEditing === true
      if (isEditable || fabricEditing) return
      // Only accept plain Delete (no text context) OR Backspace while a
      // non-text object is selected. Backspace while a Textbox is the
      // active object but NOT editing (just selected) should still
      // delete it — mirrors Acrobat's behavior.
      const active = fc.getActiveObjects()
      if (active.length === 0) return
      active.forEach((obj) => fc.remove(obj))
      fc.discardActiveObject()
      fc.renderAll()
      saveState()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveState])

  // Tool application — uses a patched version of each tool that tracks handlers
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return

    // Remove previous custom handlers only
    removeCustomHandlers()

    // Reset modes
    fc.isDrawingMode = false
    fc.selection = true
    fc.defaultCursor = 'default'

    // Create a proxy that intercepts .on('mouse:*') to track custom handlers
    const patchedCanvas = new Proxy(fc, {
      get(target, prop) {
        if (prop === 'on') {
          return (event: string, handler: (...args: any[]) => void) => {
            if (event === 'mouse:down') handlersRef.current.mouseDown = handler
            if (event === 'mouse:move') handlersRef.current.mouseMove = handler
            if (event === 'mouse:up') handlersRef.current.mouseUp = handler
            return (target.on as (e: string, h: (...a: any[]) => void) => void)(event, handler)
          }
        }
        return (target as any)[prop]
      }
    })

    switch (tool) {
      case 'edit_text':
        // Phase C of docs/MODELESS.md. In Edit Text mode we KEEP the
        // Fabric canvas interactive so user-placed annotations (Add
        // Text box, sticky notes, shapes, etc.) stay clickable — but
        // we disable marquee drag-select, because dragging across
        // empty page area should do NOTHING in text-editing mode
        // (not start a Fabric selection). Clicking an individual
        // Fabric object still selects it; paragraph boxes (z-index
        // above Fabric) win first priority on overlap.
        fc.selection = false
        fc.skipTargetFind = false
        fc.defaultCursor = 'default'
        break
      case 'select': applySelectTool(fc); break
      case 'text': applyTextTool(patchedCanvas as any, textOptions, saveState); break
      case 'draw': applyDrawTool(fc, drawingOptions); break
      case 'image': applyImageTool(patchedCanvas as any, saveState); break
      case 'highlight': applyHighlightTool(patchedCanvas as any, 'highlight', highlightColor, saveState); break
      case 'underline': applyHighlightTool(patchedCanvas as any, 'underline', highlightColor, saveState); break
      case 'strikethrough': applyHighlightTool(patchedCanvas as any, 'strikethrough', '#f38ba8', saveState); break
      case 'redact': applyHighlightTool(patchedCanvas as any, 'redact', '#000000', saveState); break
      case 'shape_rect': applyShapeTool(patchedCanvas as any, 'rectangle', shapeColor, shapeStrokeWidth, saveState); break
      case 'shape_circle': applyShapeTool(patchedCanvas as any, 'circle', shapeColor, shapeStrokeWidth, saveState); break
      case 'shape_line': applyShapeTool(patchedCanvas as any, 'line', shapeColor, shapeStrokeWidth, saveState); break
      case 'shape_arrow': applyShapeTool(patchedCanvas as any, 'arrow', shapeColor, shapeStrokeWidth, saveState); break
      case 'sticky_note': applyStickyNoteTool(patchedCanvas as any, noteColor, saveState); break
      case 'stamp': applyStampTool(patchedCanvas as any, STAMPS[selectedStamp] || STAMPS[0], saveState); break
      // ---- Comment / annotation tools (WPS-parity) ----
      case 'wipe_off': applyWipeOffTool(patchedCanvas as any, saveState); break
      case 'highlight_area': applyHighlightAreaTool(patchedCanvas as any, highlightColor, saveState); break
      case 'textbox_note': applyTextBoxAnnotationTool(patchedCanvas as any, saveState); break
      case 'link': applyLinkAnnotationTool(patchedCanvas as any, saveState); break
      case 'audio': applyAudioAnnotationTool(patchedCanvas as any, saveState); break
      case 'video': applyVideoAnnotationTool(patchedCanvas as any, saveState); break
      case 'insert_text_marker': applyInsertTextMarkerTool(patchedCanvas as any, saveState); break
      case 'replace_text_marker': applyReplaceTextMarkerTool(patchedCanvas as any, saveState); break
      case 'measure': applyMeasureTool(patchedCanvas as any, { unit: 'pt' }, saveState); break
      case 'form_designer': applyFormDesignerTool(patchedCanvas as any, { onSave: saveState }); break
      // edit_text is handled by EditableTextLayer in PageRenderer — FabricCanvas is hidden in that mode
      // ---- Fill & Sign quick stamps ----
      case 'fill_cross': applyFillCrossTool(patchedCanvas as any, '#1e66f5', saveState); break
      case 'fill_check': applyFillCheckTool(patchedCanvas as any, '#40a02b', saveState); break
      case 'fill_circle': applyFillCircleTool(patchedCanvas as any, '#1e66f5', saveState); break
      case 'fill_line': applyFillLineTool(patchedCanvas as any, '#1e1e2e', saveState); break
      case 'fill_dot': applyFillDotTool(patchedCanvas as any, '#1e1e2e', saveState); break
      case 'fill_date': applyFillDateTool(patchedCanvas as any, '#1e1e2e', saveState); break
      case 'fill_initials': applyFillInitialsTool(patchedCanvas as any, '#1e1e2e', useUIStore.getState().initials ?? 'AB', saveState); break
      case 'fill_timestamp': applyFillTimestampTool(patchedCanvas as any, '#6c7086', saveState); break
      case 'signature':
        fc.defaultCursor = 'crosshair'
        fc.selection = false
        // First click on the page captures the drop point and opens the
        // signature dialog; the dialog's onConfirm actually places the image.
        ;(patchedCanvas as any).on('mouse:down', (e: any) => {
          if (e.target) return
          const pointer = fc.getScenePoint(e.e)
          setSignaturePos({ x: pointer.x, y: pointer.y })
        })
        break
      case 'form':
        applySelectTool(fc)
        break
      default: applySelectTool(fc)
    }
  }, [tool, drawingOptions, textOptions, highlightColor, shapeColor, shapeStrokeWidth, noteColor, selectedStamp, saveState, removeCustomHandlers])

  const handleSignatureConfirm = useCallback(async (dataUrl: string) => {
    const fc = fabricRef.current
    const pos = signaturePos
    if (!fc || !pos) { setSignaturePos(null); return }
    try {
      await placeSignature(fc, dataUrl, pos.x, pos.y, saveState)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to place signature:', err)
    } finally {
      setSignaturePos(null)
    }
  }, [signaturePos, saveState])

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 1,
        // When Edit Text is the active tool we still want to SEE
        // annotations drawn via Add Text / Highlight / Shape / etc.
        // — they just shouldn't intercept clicks (those go to the
        // paragraph editor). pointerEvents:none is a one-line gate
        // that keeps the visual layer alive without changing Fabric's
        // internal state machine.
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      <canvas ref={canvasRef} />
      {signaturePos && (
        <SignatureDialog
          onClose={() => setSignaturePos(null)}
          onConfirm={handleSignatureConfirm}
        />
      )}
    </div>
  )
}
