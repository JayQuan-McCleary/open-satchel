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
  sampleParagraphColors,
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
        const canvas = await waitForCanvas()
        if (cancelled) return
        let finalParagraphs = res.paragraphs
        if (canvas && canvas.width > 0) {
          finalParagraphs = sampleParagraphColors(canvas, res.paragraphs, res.pageWidth)
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
      const isNoop = newText === para.originalText && !align
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
              bold: para.bold,
              italic: para.italic,
              align,
              itemIndices: [...para.itemIndices],
              itemOriginalTexts,
            },
          ]
      writePendingEditsForPage(tabId, pageIndex, next)
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
            currentAlign={pending?.align ?? 'left'}
            onActivate={() => setActiveId(p.id)}
            onDeactivate={() => setActiveId(null)}
            onCommit={(newText) => commitEdit(p, newText)}
            onAlign={(align) => setParagraphAlign(p, align)}
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
  currentAlign: TextAlign
  onActivate: () => void
  onDeactivate: () => void
  onCommit: (newText: string) => void
  onAlign: (align: TextAlign) => void
}

function ParagraphEditor({
  paragraph,
  scale,
  active,
  isEdited,
  initialText,
  currentAlign,
  onActivate,
  onDeactivate,
  onCommit,
  onAlign,
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
    <>
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
