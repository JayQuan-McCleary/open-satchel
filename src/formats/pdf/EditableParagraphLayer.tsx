// EditableParagraphLayer — Acrobat-style paragraph-level editing.
//
// This is the inline text editor we land on after learning that span-level
// (per-TJ-element) editing causes visual flicker and produces fragmented
// edits. Acrobat, Foxit, and WPS all work at the paragraph level with
// visible bounding boxes. This component does the same:
//
//   1. Cluster pdfjs text items into paragraph boxes at mount
//   2. Draw a thin outline over each paragraph
//   3. On click, the clicked paragraph becomes a contenteditable div
//      sized to the bbox. Browser reflow handles wrapping while typing.
//   4. On blur or on every input, store the diff in `_paragraphEdits`
//      on the page state — no canvas repaint during editing
//   5. On save, pdfHandler.save whiteouts the bbox and draws the new
//      text in its place via applyParagraphEditsToBytes

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import { useHistoryStore } from '../../stores/historyStore'
import {
  clusterParagraphs,
  getParagraphTextColorsFromStream,
  sampleParagraphBackgrounds,
  type ParagraphBox,
  type TextItem,
} from '../../services/pdfParagraphs'
import type { ParagraphEdit, TextAlign } from '../../services/pdfParagraphEdits'
import type { PdfFormatState } from './index'

interface Props {
  tabId: string
  pageIndex: number
  pdfDoc: PDFDocumentProxy
  /** Displayed canvas width in CSS pixels. */
  width: number
  /** Displayed canvas height in CSS pixels. */
  height: number
  /** When true, paragraph outlines are rendered and click-to-edit is
   *  armed. When false, the layer stays MOUNTED — cluster state and
   *  pending `_paragraphEdits` remain cached — but the outlines are
   *  hidden and the whole layer has pointer-events:none so clicks
   *  fall through to Fabric / the canvas. Flipping this prop is
   *  instant because no remount / re-cluster happens.
   *
   *  Part of the modeless-editing refactor (docs/MODELESS.md Phase A).
   *  Previously the layer only mounted when tool === 'edit_text' and
   *  unmounted otherwise, which blew away cluster state on every tool
   *  switch AND prevented annotations on other layers from being seen
   *  because THIS layer (when mounted) covered them. Always-mount +
   *  prop-gated visibility avoids both. */
  active?: boolean
}

// pdfParagraphs.ts now resolves fontFamily from pdfjs's styles map and
// emits bold/italic flags, so we use those per-paragraph instead of a
// single global stack.
const FALLBACK_FONT_STACK = `-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`

function readPendingEditsForPage(tabId: string, pageIndex: number): ParagraphEdit[] {
  const state = useFormatStore.getState().data[tabId] as PdfFormatState | undefined
  if (!state) return []
  const page = state.pages.find((p) => p.pageIndex === pageIndex) as
    | (PdfFormatState['pages'][number] & { _paragraphEdits?: ParagraphEdit[] })
    | undefined
  return page?._paragraphEdits ?? []
}

function writePendingEditsForPage(tabId: string, pageIndex: number, edits: ParagraphEdit[]) {
  useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
    ...prev,
    pages: prev.pages.map((p) =>
      p.pageIndex === pageIndex
        ? ({ ...p, _paragraphEdits: edits.length > 0 ? edits : undefined } as any)
        : p,
    ),
  }))
  // Mark dirty iff any page has pending edits.
  const anyDirty = useFormatStore
    .getState()
    .data[tabId] != null
  if (edits.length > 0) useTabStore.getState().setTabDirty(tabId, true)
  // If we just cleared the last edit, leave the dirty flag alone —
  // other edit systems (Fabric, page rotates) might still be dirty.
  void anyDirty
}

export default function EditableParagraphLayer({ tabId, pageIndex, pdfDoc, width, height, active = true }: Props) {
  const [paragraphs, setParagraphs] = useState<ParagraphBox[]>([])
  const [basePageSize, setBasePageSize] = useState<{ w: number; h: number } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)

  // Cluster paragraphs once per (pdfDoc, pageIndex). Re-runs if pdfBytes
  // change because pdfDoc identity then changes.
  useEffect(() => {
    let cancelled = false

    // Wait for the sibling canvas to signal paint completion before
    // sampling bg colors. Previously clusterParagraphs resolved ~200ms
    // in but the pdfjs canvas render ran ~300ms+; sampling ran against
    // a blank white canvas and marked every paragraph as light-bg, so
    // the save mask painted white over dark headers.
    const waitForCanvas = async (): Promise<HTMLCanvasElement | null> => {
      const start = Date.now()
      const MAX_WAIT = 2500
      while (Date.now() - start < MAX_WAIT) {
        if (cancelled) return null
        const layer = layerRef.current
        const sibling = layer?.parentElement?.querySelector('canvas') as HTMLCanvasElement | null
        if (sibling && sibling.width > 0 && sibling.dataset.ready === '1') return sibling
        await new Promise((r) => setTimeout(r, 50))
      }
      // Timed out; use whatever canvas exists, accept potential inaccuracy.
      const layer = layerRef.current
      return (layer?.parentElement?.querySelector('canvas') as HTMLCanvasElement | null) ?? null
    }

    ;(async () => {
      try {
        const res = await clusterParagraphs(pdfDoc, pageIndex)
        if (cancelled) return
        let finalParagraphs = res.paragraphs

        // Authoritative text color from the PDF's own content stream.
        // The layer-hosting format store holds the raw pdfBytes; we
        // parse them once per page to pull graphics-state colors and
        // attach them to each paragraph. No luminance heuristic — the
        // color is whatever the PDF author set with rg/g/k/scn.
        const state = useFormatStore.getState().data[tabId] as PdfFormatState | undefined
        const pdfBytes = state?.pdfBytes
        if (pdfBytes) {
          try {
            const colorMap = await getParagraphTextColorsFromStream(
              pdfBytes,
              pageIndex,
              res.paragraphs,
              res.pageHeight,
            )
            if (cancelled) return
            finalParagraphs = finalParagraphs.map((p) => {
              const c = colorMap.get(p.id)
              if (!c) return p
              // Luminance of the text color — used by the in-edit
              // mask to pick dark-behind-light-text vs the reverse.
              // Works regardless of the actual bg color.
              const r = parseInt(c.slice(1, 3), 16) / 255
              const g = parseInt(c.slice(3, 5), 16) / 255
              const b = parseInt(c.slice(5, 7), 16) / 255
              const lum = 0.299 * r + 0.587 * g + 0.114 * b
              return { ...p, color: c, onDarkBackground: lum > 0.5 }
            })
          } catch (err) {
            console.warn('[EditableParagraphLayer] text-color extract failed:', err)
          }
        }

        // Background color for save-time mask — still sampled from
        // canvas because the content stream doesn't give us a clean
        // "what was painted behind this text" without replaying the
        // graphics ops. Requires the canvas to be rendered.
        const canvas = await waitForCanvas()
        if (cancelled) return
        if (canvas && canvas.width > 0) {
          finalParagraphs = sampleParagraphBackgrounds(canvas, finalParagraphs, res.pageWidth)
        }
        setParagraphs(finalParagraphs)
        setBasePageSize({ w: res.pageWidth, h: res.pageHeight })
      } catch (err) {
        console.error('[EditableParagraphLayer] cluster failed:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pdfDoc, pageIndex])

  // CSS-pixels per PDF-user-space-unit. pdfjs returns geometry at scale=1,
  // the canvas is rendered at zoom — we scale the overlay to match.
  const scale = basePageSize ? width / basePageSize.w : 1

  // Subscribe to this page's _paragraphEdits array so the layer re-renders
  // whenever the store changes (history undo/redo, drag-commit, or a
  // typing commit). The selector returns the array reference — zustand
  // triggers a re-render whenever that reference changes, which is on
  // every writePendingEditsForPage. Children then see fresh `pending` and
  // fresh `committedDelta` props, so positional changes from undo/redo
  // propagate without a remount.
  //
  // `_paragraphEdits` is a runtime field the layer attaches to each
  // PdfPageState; it isn't part of the formal type so we cast per-page.
  const pageEdits = useFormatStore((s): ParagraphEdit[] | undefined => {
    const state = s.data[tabId] as PdfFormatState | undefined
    const page = state?.pages.find((p) => p.pageIndex === pageIndex) as
      | (PdfFormatState['pages'][number] & { _paragraphEdits?: ParagraphEdit[] })
      | undefined
    return page?._paragraphEdits
  })

  const pendingById = useMemo(() => {
    const edits: ParagraphEdit[] = pageEdits ?? []
    return new Map(edits.map((e) => [e.paragraphId, e]))
  }, [pageEdits])

  // Items snapshot from the most recent cluster call. We need this at
  // commit time so each edit carries the pdfjs TextLayer indices of
  // every run it replaces — the save pipeline uses those to blank the
  // original ops in the content stream (no ghost text on re-extract).
  const itemsRef = useRef<TextItem[]>([])
  useEffect(() => {
    let cancelled = false
    clusterParagraphs(pdfDoc, pageIndex).then((res) => {
      if (cancelled) return
      itemsRef.current = res.items
    }).catch(() => {})
    return () => { cancelled = true }
  }, [pdfDoc, pageIndex])

  // Snapshot of _paragraphEdits at the moment the user CLICKS INTO a
  // paragraph. We diff against this when they leave (blur OR activeId
  // changes) and push ONE history entry per commit — per-keystroke
  // pushes would bloat the stack and make undo feel jumpy.
  const editSessionBeforeRef = useRef<ParagraphEdit[] | undefined>(undefined)
  // Mirror of activeId one-render behind so a useEffect can detect the
  // exact transition from "something active" → "nothing active" and
  // flush history. onBlur isn't reliable (automation, focus-steal).
  const prevActiveIdRef = useRef<string | null>(null)

  const commitEdit = useCallback(
    (para: ParagraphBox, newText: string, overrideAlign?: TextAlign) => {
      const existing = readPendingEditsForPage(tabId, pageIndex)
      const without = existing.filter((e) => e.paragraphId !== para.id)
      const prevEdit = existing.find((e) => e.paragraphId === para.id)
      const align = overrideAlign ?? prevEdit?.align
      const positionDelta = prevEdit?.positionDelta
      const isNoop = newText === para.originalText && !align && !positionDelta
      const itemOriginalTexts = para.itemIndices.map((idx) => itemsRef.current[idx]?.str ?? '')
      const next: ParagraphEdit[] = isNoop
        ? without
        : [
            ...without,
            {
              paragraphId: para.id,
              bbox: para.bbox,
              originalText: para.originalText,
              newText,
              fontSize: para.fontSize,
              color: para.color,
              backgroundColor: para.backgroundColor,
              fontFamily: para.fontFamily,
              bold: para.bold,
              italic: para.italic,
              align,
              itemIndices: [...para.itemIndices],
              itemOriginalTexts,
              positionDelta,
            },
          ]
      writePendingEditsForPage(tabId, pageIndex, next)
    },
    [tabId, pageIndex],
  )

  // Commit a new drag offset for this paragraph. Text, alignment, and
  // other edit fields are preserved; only positionDelta changes. Pushes
  // one history entry per drag (onPointerUp), not per mousemove.
  const commitMove = useCallback(
    (para: ParagraphBox, delta: { dx: number; dy: number }) => {
      const before = readPendingEditsForPage(tabId, pageIndex).map((e) => ({ ...e }))
      const existing = readPendingEditsForPage(tabId, pageIndex)
      const without = existing.filter((e) => e.paragraphId !== para.id)
      const prevEdit = existing.find((e) => e.paragraphId === para.id)
      // Drop positionDelta back to undefined when it lands back at origin
      // so isNoop cleanup still fires if text+align are also unchanged.
      const isZero = Math.abs(delta.dx) < 0.01 && Math.abs(delta.dy) < 0.01
      const newDelta = isZero ? undefined : delta
      const newText = prevEdit?.newText ?? para.originalText
      const align = prevEdit?.align
      const isNoop = newText === para.originalText && !align && !newDelta
      const itemOriginalTexts =
        prevEdit?.itemOriginalTexts ??
        para.itemIndices.map((idx) => itemsRef.current[idx]?.str ?? '')
      const next: ParagraphEdit[] = isNoop
        ? without
        : [
            ...without,
            {
              paragraphId: para.id,
              bbox: para.bbox,
              originalText: para.originalText,
              newText,
              fontSize: para.fontSize,
              color: para.color,
              backgroundColor: para.backgroundColor,
              fontFamily: para.fontFamily,
              bold: para.bold,
              italic: para.italic,
              align,
              itemIndices: [...para.itemIndices],
              itemOriginalTexts,
              positionDelta: newDelta,
            },
          ]
      writePendingEditsForPage(tabId, pageIndex, next)
      const after = readPendingEditsForPage(tabId, pageIndex).map((e) => ({ ...e }))
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        useHistoryStore.getState().pushUndo({
          type: 'paragraph_edits',
          tabId,
          pageIndex,
          before: before.length > 0 ? before : undefined,
          after,
        })
      }
    },
    [tabId, pageIndex],
  )

  const beginEditSession = useCallback(() => {
    editSessionBeforeRef.current = readPendingEditsForPage(tabId, pageIndex).map((e) => ({ ...e }))
  }, [tabId, pageIndex])

  const endEditSession = useCallback(() => {
    const before = editSessionBeforeRef.current
    editSessionBeforeRef.current = undefined
    if (before === undefined) return
    const after = readPendingEditsForPage(tabId, pageIndex).map((e) => ({ ...e }))
    if (JSON.stringify(before) === JSON.stringify(after)) return
    useHistoryStore.getState().pushUndo({
      type: 'paragraph_edits',
      tabId,
      pageIndex,
      before,
      after,
    })
  }, [tabId, pageIndex])

  // Activation watcher: on any change to activeId, start or end the
  // edit session. Covers the automation case where programmatic
  // .blur() doesn't fire React's synthetic onBlur, AND keeps a single
  // source of truth for session lifecycle (no double-counting if the
  // user clicks from one paragraph directly to another — activeId
  // transitions A → null only briefly, or A → B with just one push).
  useEffect(() => {
    const prev = prevActiveIdRef.current
    if (prev !== null && activeId !== prev) {
      // Leaving a previously-active paragraph — flush.
      endEditSession()
    }
    if (activeId !== null && activeId !== prev) {
      // Entering a new paragraph.
      beginEditSession()
    }
    prevActiveIdRef.current = activeId
  }, [activeId, beginEditSession, endEditSession])

  const setParagraphAlign = useCallback(
    (para: ParagraphBox, align: TextAlign) => {
      // Alignment changes are their own atomic history entry — snapshot
      // before and flush after with a direct push, regardless of the
      // active-session machinery.
      const before = readPendingEditsForPage(tabId, pageIndex).map((e) => ({ ...e }))
      const existing = readPendingEditsForPage(tabId, pageIndex)
      const prev = existing.find((e) => e.paragraphId === para.id)
      const text = prev?.newText ?? para.originalText
      commitEdit(para, text, align)
      const after = readPendingEditsForPage(tabId, pageIndex).map((e) => ({ ...e }))
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        useHistoryStore.getState().pushUndo({
          type: 'paragraph_edits',
          tabId,
          pageIndex,
          before: before.length > 0 ? before : undefined,
          after,
        })
      }
    },
    [tabId, pageIndex, commitEdit],
  )

  return (
    <div
      ref={layerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        zIndex: 5,
        // Container is transparent by default; individual ParagraphEditor
        // boxes each enable their own pointer-events when `active` is
        // true. When the layer itself is inactive (tool !== 'edit_text'
        // in modeless terms) we short-circuit by rendering no children —
        // cluster state stays cached in React state so switching back
        // is instant.
        pointerEvents: 'none',
      }}
      data-testid="editable-paragraph-layer"
      data-active={active ? '1' : '0'}
    >
      {active && paragraphs.map((p) => {
        const pending = pendingById.get(p.id)
        const text = pending?.newText ?? p.originalText
        const committedDelta = pending?.positionDelta ?? { dx: 0, dy: 0 }
        return (
          <ParagraphEditor
            key={p.id}
            paragraph={p}
            scale={scale}
            pageWidth={basePageSize?.w ?? 0}
            pageHeight={basePageSize?.h ?? 0}
            active={activeId === p.id}
            isEdited={!!pending}
            initialText={text}
            currentAlign={pending?.align ?? 'left'}
            committedDelta={committedDelta}
            onActivate={() => setActiveId(p.id)}
            onDeactivate={() => setActiveId(null)}
            onCommit={(newText) => commitEdit(p, newText)}
            onAlign={(align) => setParagraphAlign(p, align)}
            onMove={(delta) => commitMove(p, delta)}
          />
        )
      })}
    </div>
  )
}

interface ParagraphEditorProps {
  paragraph: ParagraphBox
  scale: number
  /** Page dimensions in viewport (scale=1) coords. Used to clamp drag so
   *  the box can't be dragged fully off the page. */
  pageWidth: number
  pageHeight: number
  active: boolean
  isEdited: boolean
  initialText: string
  currentAlign: TextAlign
  /** Committed drag offset from the store (in viewport units). Live drag
   *  additions are layered on top while the pointer is down. */
  committedDelta: { dx: number; dy: number }
  onActivate: () => void
  onDeactivate: () => void
  onCommit: (newText: string) => void
  onAlign: (align: TextAlign) => void
  onMove: (delta: { dx: number; dy: number }) => void
}

// Minimum cursor travel (CSS px) before we treat a pointer-down-then-move
// as a drag rather than a click. 3px matches browser click-jitter tolerance.
const DRAG_THRESHOLD_PX = 3

function ParagraphEditor({
  paragraph,
  scale,
  pageWidth,
  pageHeight,
  active,
  isEdited,
  initialText,
  currentAlign,
  committedDelta,
  onActivate,
  onDeactivate,
  onCommit,
  onAlign,
  onMove,
}: ParagraphEditorProps) {
  const divRef = useRef<HTMLDivElement>(null)
  // Shadow state so we don't rewrite the div on every commit (would reset
  // caret). We only seed it when (paragraph,initialText) changes.
  const seededRef = useRef<string>('')

  useEffect(() => {
    const el = divRef.current
    if (!el) return
    // While the user is actively typing, the DOM has already reflected
    // their input and rewriting textContent here would reset the caret.
    // The layer re-renders per-keystroke now (it subscribes to the edit
    // store for undo/redo propagation), so the initialText prop changes
    // often — but we only need to seed the div when the box is NOT
    // being edited (initial mount, re-mount, or a history revert).
    if (active) return
    if (seededRef.current !== initialText) {
      el.textContent = initialText
      seededRef.current = initialText
    }
  }, [initialText, active])

  // ── Drag state ──────────────────────────────────────────────────
  // localDelta is the authoritative paragraph offset for this child,
  // independent of the parent's render cycle. Initialized from the
  // committedDelta prop (which the parent reads from the store on mount
  // or whenever pendingById recomputes) and updated on every drag-in-
  // progress plus on drag-end. This matters because the parent does NOT
  // subscribe to the store, so the committedDelta prop stays stale
  // between renders — if we cleared a pure "liveOffset" state on
  // pointerup and relied on committedDelta for the settled position,
  // the box would snap back to origin after release.
  const [localDelta, setLocalDelta] = useState<{ dx: number; dy: number }>(() => committedDelta)
  // When the store-derived prop changes value (undo/redo, tab switch),
  // mirror it locally — but never during an active drag, so we don't
  // fight the user mid-gesture.
  useEffect(() => {
    setLocalDelta((prev) => {
      if (prev.dx === committedDelta.dx && prev.dy === committedDelta.dy) return prev
      if (pointerRef.current?.dragging) return prev
      return committedDelta
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedDelta.dx, committedDelta.dy])
  // Pointer-session bookkeeping. Kept in a ref because these fields don't
  // drive rendering directly — setLocalDelta does.
  const pointerRef = useRef<{
    startClientX: number
    startClientY: number
    pointerId: number
    dragging: boolean
    baseDelta: { dx: number; dy: number }
  } | null>(null)
  // onPointerUp fires before onClick for the same gesture. When we've
  // just finished a drag we set this so the onClick handler skips
  // activating the contenteditable (otherwise dragging a paragraph
  // would also drop you into edit mode).
  const justDraggedRef = useRef(false)

  const clampDelta = useCallback(
    (dx: number, dy: number): { dx: number; dy: number } => {
      // Keep at least a small portion of the box on-page so the user
      // can always grab it again. Clamp against pageWidth/pageHeight
      // (which are scale=1, matching bbox units).
      if (pageWidth <= 0 || pageHeight <= 0) return { dx, dy }
      const minVisible = 12 // viewport units
      const minX = minVisible - paragraph.bbox.x - paragraph.bbox.width
      const maxX = pageWidth - paragraph.bbox.x - minVisible
      const minY = minVisible - paragraph.bbox.y - paragraph.bbox.height
      const maxY = pageHeight - paragraph.bbox.y - minVisible
      return {
        dx: Math.max(minX, Math.min(maxX, dx)),
        dy: Math.max(minY, Math.min(maxY, dy)),
      }
    },
    [pageWidth, pageHeight, paragraph.bbox.x, paragraph.bbox.y, paragraph.bbox.width, paragraph.bbox.height],
  )

  const left = (paragraph.bbox.x + localDelta.dx) * scale
  const top = (paragraph.bbox.y + localDelta.dy) * scale
  const boxW = paragraph.bbox.width * scale
  const boxH = paragraph.bbox.height * scale
  const displayFontSize = Math.max(6, paragraph.fontSize * scale)
  // Resolved font stack from pdfjs styles, with fallback.
  const fontStack = paragraph.fontFamily || FALLBACK_FONT_STACK
  const isDragging = pointerRef.current?.dragging === true

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // While editing text, let the contenteditable handle pointer events
    // normally (caret placement, text selection). Drag only applies to
    // unopened paragraphs.
    if (active) return
    if (e.button !== 0) return
    pointerRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      pointerId: e.pointerId,
      dragging: false,
      baseDelta: { dx: localDelta.dx, dy: localDelta.dy },
    }
    // setPointerCapture makes move/up fire on this element even when
    // the cursor escapes the box (the user can drag way off in any
    // direction and we still get the up event).
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Older engines may throw if the pointer isn't captureable; fall
      // back to window-level listeners implicitly (browsers re-target).
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = pointerRef.current
    if (!st || st.pointerId !== e.pointerId) return
    const rawDx = e.clientX - st.startClientX
    const rawDy = e.clientY - st.startClientY
    if (!st.dragging && Math.hypot(rawDx, rawDy) > DRAG_THRESHOLD_PX) {
      st.dragging = true
    }
    if (st.dragging) {
      const next = clampDelta(
        st.baseDelta.dx + rawDx / scale,
        st.baseDelta.dy + rawDy / scale,
      )
      setLocalDelta(next)
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = pointerRef.current
    if (!st || st.pointerId !== e.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    const wasDragging = st.dragging
    pointerRef.current = null
    if (wasDragging) {
      // localDelta state may not have flushed yet (synthetic events fire
      // in the same sync tick; React batches). Recompute from the ref's
      // baseDelta + raw pointer delta so we write the authoritative
      // position to the store regardless of whether React has
      // re-rendered.
      const rawDx = e.clientX - st.startClientX
      const rawDy = e.clientY - st.startClientY
      const finalDelta = clampDelta(
        st.baseDelta.dx + rawDx / scale,
        st.baseDelta.dy + rawDy / scale,
      )
      setLocalDelta(finalDelta)
      onMove(finalDelta)
      justDraggedRef.current = true
    }
  }

  // When the paragraph has been moved, the live canvas beneath still
  // contains the ORIGINAL glyphs — they're only blanked at save time.
  // Without a preview mask here the user sees the text at TWO places
  // (the overlay at the new position + the raw canvas at the old one)
  // which looks like a duplication bug. Paint an opaque rect over the
  // original bbox in the detected background color so the preview
  // matches what the saved PDF will show.
  const hasMoved = localDelta.dx !== 0 || localDelta.dy !== 0
  const origLeft = paragraph.bbox.x * scale
  const origTop = paragraph.bbox.y * scale
  return (
    <>
    {hasMoved && (
      <div
        style={{
          position: 'absolute',
          left: origLeft,
          top: origTop,
          width: boxW,
          height: boxH,
          background: paragraph.onDarkBackground
            ? 'rgba(15,17,21,0.97)'
            : 'rgba(255,255,255,0.97)',
          // Dashed outline in a muted color marks this as the "empty"
          // origin slot — helps the user undo or visualize where the
          // box came from without it looking like active content.
          outline: '1px dashed rgba(137,180,250,0.25)',
          outlineOffset: 0,
          pointerEvents: 'none',
          zIndex: 4,
        }}
      />
    )}
    {active && (
      <AlignToolbar
        left={left}
        top={top}
        width={boxW}
        current={currentAlign}
        onPick={onAlign}
      />
    )}
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: boxW,
        minHeight: boxH,
        pointerEvents: 'auto',
        cursor: active ? 'text' : isDragging ? 'grabbing' : 'grab',
        // While actively dragging, dim the outline so the user perceives
        // the box as "picked up". Otherwise keep the existing three-state
        // Acrobat-style affordance.
        outline: active
          ? '2px solid #89b4fa'
          : isDragging
            ? '2px solid #89b4fa'
            : isEdited
              ? '1px solid #f59e0b'
              : '1px dashed rgba(137,180,250,0.5)',
        outlineOffset: 0,
        // When editing, mask the canvas beneath so the caret + typed
        // text are clearly visible. For dark-background paragraphs we
        // flip to a dark mask + light text; otherwise light mask +
        // dark text. This matches the saved PDF's color scheme — what
        // you see while editing is what you get after save.
        //
        // During a drag we also show the mask so the box visually
        // "carries" its content while in flight, matching Acrobat/Foxit
        // behaviour where the moved block overlays whatever's underneath.
        background: active || isEdited || isDragging
          ? paragraph.onDarkBackground
            ? 'rgba(15,17,21,0.97)'
            : 'rgba(255,255,255,0.97)'
          : 'transparent',
        color: active || isEdited || isDragging ? paragraph.color : 'transparent',
        caretColor: paragraph.color,
        fontFamily: fontStack,
        fontSize: displayFontSize,
        fontWeight: paragraph.bold ? 700 : 400,
        fontStyle: paragraph.italic ? 'italic' : 'normal',
        // Reflect alignment live in the contenteditable so the in-edit
        // view matches what save will produce.
        textAlign: currentAlign === 'justify' ? 'justify' : currentAlign,
        lineHeight: 1.2,
        padding: 0,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        // Suppress default text selection during drag — otherwise
        // clicking-and-dragging would start a selection before our
        // threshold kicks in.
        userSelect: active ? 'text' : 'none',
        WebkitUserSelect: active ? 'text' : 'none',
        // Prevent the browser's native drag-ghost on text.
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => {
        if (justDraggedRef.current) {
          // Click that follows a drag release — swallow it, don't
          // activate the editor.
          justDraggedRef.current = false
          return
        }
        if (!active) {
          onActivate()
          // Defer focus so the browser applies contentEditable before
          // .focus(); otherwise caret placement is flaky.
          requestAnimationFrame(() => {
            divRef.current?.focus()
          })
        }
      }}
      onBlur={(e) => {
        const newText = e.currentTarget.textContent ?? ''
        onCommit(newText)
        onDeactivate()
      }}
      onInput={(e) => {
        // Commit on every input so state is always up to date. We skip
        // rewriting div contents on commit (seededRef guard above), so
        // the caret doesn't jump.
        const newText = (e.currentTarget as HTMLDivElement).textContent ?? ''
        onCommit(newText)
      }}
      onKeyDown={(e) => {
        // Escape: cancel back to original text, blur.
        if (e.key === 'Escape') {
          e.preventDefault()
          if (divRef.current) divRef.current.textContent = paragraph.originalText
          onCommit(paragraph.originalText)
          divRef.current?.blur()
        }
        // Alignment shortcuts — Word/GDocs convention: Ctrl+L/E/R/J.
        // ctrlKey covers both Ctrl (Win/Linux) and Cmd (macOS via metaKey)
        // so match either.
        const isMod = e.ctrlKey || e.metaKey
        if (isMod) {
          if (e.key === 'l' || e.key === 'L') { e.preventDefault(); onAlign('left') }
          else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); onAlign('center') }
          else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); onAlign('right') }
          else if (e.key === 'j' || e.key === 'J') { e.preventDefault(); onAlign('justify') }
        }
      }}
      contentEditable={active}
      suppressContentEditableWarning
      ref={divRef}
      data-paragraph-id={paragraph.id}
    />
    </>
  )
}

// ── Alignment toolbar ────────────────────────────────────────────
// Small floating strip that appears above the active paragraph with
// Left/Center/Right/Justify buttons. Clicking routes back to
// setParagraphAlign which updates the edit state AND pushes a history
// entry so the change is undoable.

interface AlignToolbarProps {
  left: number
  top: number
  width: number
  current: TextAlign
  onPick: (align: TextAlign) => void
}

function AlignToolbar({ left, top, width, current, onPick }: AlignToolbarProps) {
  // Position toolbar just above the paragraph box. Clamp to min-top so
  // paragraphs near the very top of the page still show the toolbar.
  const TOOLBAR_H = 28
  const GAP = 4
  const toolbarTop = Math.max(2, top - TOOLBAR_H - GAP)
  const items: { key: TextAlign; label: string; title: string }[] = [
    { key: 'left', label: '⇤', title: 'Align left (Ctrl+L)' },
    { key: 'center', label: '≡', title: 'Align center (Ctrl+E)' },
    { key: 'right', label: '⇥', title: 'Align right (Ctrl+R)' },
    { key: 'justify', label: '☰', title: 'Justify (Ctrl+J)' },
  ]
  return (
    <div
      style={{
        position: 'absolute',
        left: Math.max(2, left),
        top: toolbarTop,
        minWidth: 120,
        maxWidth: Math.max(120, width),
        height: TOOLBAR_H,
        background: 'var(--bg-surface, #1e222b)',
        border: '1px solid var(--border, #2a2f3a)',
        borderRadius: 4,
        padding: '2px 4px',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        pointerEvents: 'auto',
        zIndex: 20,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}
      // Don't steal focus from the contenteditable when clicked.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.key}
          title={it.title}
          onClick={() => onPick(it.key)}
          style={{
            width: 28,
            height: 22,
            fontSize: 14,
            lineHeight: '20px',
            background: current === it.key ? 'var(--accent, #3b82f6)' : 'transparent',
            color: current === it.key ? '#fff' : 'var(--text-primary, #e6e8ec)',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
