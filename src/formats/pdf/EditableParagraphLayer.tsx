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
import {
  clusterParagraphs,
  sampleParagraphColors,
  type ParagraphBox,
  type TextItem,
} from '../../services/pdfParagraphs'
import type { ParagraphEdit } from '../../services/pdfParagraphEdits'
import type { PdfFormatState } from './index'

interface Props {
  tabId: string
  pageIndex: number
  pdfDoc: PDFDocumentProxy
  /** Displayed canvas width in CSS pixels. */
  width: number
  /** Displayed canvas height in CSS pixels. */
  height: number
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

export default function EditableParagraphLayer({ tabId, pageIndex, pdfDoc, width, height }: Props) {
  const [paragraphs, setParagraphs] = useState<ParagraphBox[]>([])
  const [basePageSize, setBasePageSize] = useState<{ w: number; h: number } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)

  // Cluster paragraphs once per (pdfDoc, pageIndex). Re-runs if pdfBytes
  // change because pdfDoc identity then changes.
  useEffect(() => {
    let cancelled = false
    clusterParagraphs(pdfDoc, pageIndex)
      .then((res) => {
        if (cancelled) return

        // Once clustering is done, walk up to the sibling <canvas> on
        // the PageRenderer and sample the rendered pixels so we can
        // infer each paragraph's text color (white on dark header vs
        // black on light body). Without this, every edit defaults to
        // black and invisibly vanishes on dark-bg paragraphs.
        let finalParagraphs = res.paragraphs
        const layer = layerRef.current
        const sibling = layer?.parentElement?.querySelector('canvas') as HTMLCanvasElement | null
        if (sibling && sibling.width > 0) {
          finalParagraphs = sampleParagraphColors(sibling, res.paragraphs, res.pageWidth)
        }
        setParagraphs(finalParagraphs)
        setBasePageSize({ w: res.pageWidth, h: res.pageHeight })
      })
      .catch((err) => {
        console.error('[EditableParagraphLayer] cluster failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [pdfDoc, pageIndex])

  // CSS-pixels per PDF-user-space-unit. pdfjs returns geometry at scale=1,
  // the canvas is rendered at zoom — we scale the overlay to match.
  const scale = basePageSize ? width / basePageSize.w : 1

  // Snapshot of pending edits so React renders the pre-typed text when a
  // box is re-mounted (e.g. after tool toggle or tab switch).
  const pendingById = useMemo(() => {
    const edits = readPendingEditsForPage(tabId, pageIndex)
    return new Map(edits.map((e) => [e.paragraphId, e]))
    // Depends on the store data so selectors and re-render correctly.
    // Reading through getState() avoids subscribing to the full data map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, pageIndex, paragraphs.length])

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

  const commitEdit = useCallback(
    (para: ParagraphBox, newText: string) => {
      const existing = readPendingEditsForPage(tabId, pageIndex)
      const without = existing.filter((e) => e.paragraphId !== para.id)
      const isNoop = newText === para.originalText
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
              // Pass sampled color through so drawText uses the right
              // ink — white on dark headers, black on body text.
              color: para.color,
              itemIndices: [...para.itemIndices],
              itemOriginalTexts,
            },
          ]
      writePendingEditsForPage(tabId, pageIndex, next)
    },
    [tabId, pageIndex],
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
        pointerEvents: 'none', // container itself is transparent; boxes enable pointer events
      }}
      data-testid="editable-paragraph-layer"
    >
      {paragraphs.map((p) => {
        const pending = pendingById.get(p.id)
        const text = pending?.newText ?? p.originalText
        return (
          <ParagraphEditor
            key={p.id}
            paragraph={p}
            scale={scale}
            active={activeId === p.id}
            isEdited={!!pending}
            initialText={text}
            onActivate={() => setActiveId(p.id)}
            onDeactivate={() => setActiveId(null)}
            onCommit={(newText) => commitEdit(p, newText)}
          />
        )
      })}
    </div>
  )
}

interface ParagraphEditorProps {
  paragraph: ParagraphBox
  scale: number
  active: boolean
  isEdited: boolean
  initialText: string
  onActivate: () => void
  onDeactivate: () => void
  onCommit: (newText: string) => void
}

function ParagraphEditor({
  paragraph,
  scale,
  active,
  isEdited,
  initialText,
  onActivate,
  onDeactivate,
  onCommit,
}: ParagraphEditorProps) {
  const divRef = useRef<HTMLDivElement>(null)
  // Shadow state so we don't rewrite the div on every commit (would reset
  // caret). We only seed it when (paragraph,initialText) changes.
  const seededRef = useRef<string>('')

  useEffect(() => {
    const el = divRef.current
    if (!el) return
    if (seededRef.current !== initialText) {
      el.textContent = initialText
      seededRef.current = initialText
    }
  }, [initialText])

  const left = paragraph.bbox.x * scale
  const top = paragraph.bbox.y * scale
  const boxW = paragraph.bbox.width * scale
  const boxH = paragraph.bbox.height * scale
  const displayFontSize = Math.max(6, paragraph.fontSize * scale)
  // Resolved font stack from pdfjs styles, with fallback.
  const fontStack = paragraph.fontFamily || FALLBACK_FONT_STACK

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: boxW,
        minHeight: boxH,
        pointerEvents: 'auto',
        cursor: active ? 'text' : 'pointer',
        // Thin outline always visible in edit mode — Acrobat-style
        // bounding-box affordance. Active box gets a solid accent outline;
        // edited boxes get a distinctive color so the user can see what's
        // been changed but not yet saved.
        outline: active
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
        background: active || isEdited
          ? paragraph.onDarkBackground
            ? 'rgba(15,17,21,0.97)'
            : 'rgba(255,255,255,0.97)'
          : 'transparent',
        color: active || isEdited ? paragraph.color : 'transparent',
        caretColor: paragraph.color,
        // Match the paragraph's original styling as closely as the
        // pdfjs metadata allows. Users can see if their edit is
        // "reading" right before they save.
        fontFamily: fontStack,
        fontSize: displayFontSize,
        fontWeight: paragraph.bold ? 700 : 400,
        fontStyle: paragraph.italic ? 'italic' : 'normal',
        lineHeight: 1.2,
        padding: 0,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      onClick={() => {
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
      }}
      contentEditable={active}
      suppressContentEditableWarning
      ref={divRef}
      data-paragraph-id={paragraph.id}
    />
  )
}
