import { useEffect, useRef, useState, useCallback } from 'react'
import type { FormatViewerProps } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import type { PdfFormatState } from './index'
import PageRenderer from './PageRenderer'
import PdfSearchBar from './PdfSearchBar'
import { usePdfDocument } from '../../components/viewer/usePdfDocument'
import { useViewerFeatures, installAutoScroll, EYE_PROTECTION_FILTER } from '../../services/viewerFeatures'
import LayersPanel from '../../components/editor/LayersPanel'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import {
  parseContentStream, getPageContentBytes, writePageContentBytes,
  serializeContentStream, applyTextReplacement, encodeTextToBytes,
} from '../../services/contentStreamParser'
import { extractTextItems } from '../../services/pdfTextExtract'

export default function PdfViewer({ tabId }: FormatViewerProps) {
  const state = useFormatStore((s) => s.data[tabId] as PdfFormatState | undefined)
  const tool = useUIStore((s) => s.tool)
  const setCurrentPage = useUIStore((s) => s.setCurrentPage)
  const searchVisible = useUIStore((s) => s.searchVisible)
  const setSearchVisible = useUIStore((s) => s.setSearchVisible)
  const showLayers = useUIStore((s) => s.showLayers)
  const currentPage = useUIStore((s) => s.currentPage)
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfDoc = usePdfDocument(state?.pdfBytes ?? null)
  const [searchMatches, setSearchMatches] = useState(0)
  const prevToolRef = useRef(tool)

  // When leaving edit_text mode, apply pending text edits to pdfBytes
  useEffect(() => {
    const prevTool = prevToolRef.current
    prevToolRef.current = tool

    if (prevTool === 'edit_text' && tool !== 'edit_text') {
      // Read FRESH state from the store — not the render closure,
      // because the input handler may have updated it after this render.
      const freshState = useFormatStore.getState().data[tabId] as PdfFormatState | undefined
      if (!freshState) return
      const pagesWithEdits = (freshState.pages as any[]).filter(p => p._textLayerEdits?.length > 0)
      if (pagesWithEdits.length === 0) return

      ;(async () => {
        try {
          const doc = await PDFDocument.load(freshState.pdfBytes)
          let anyModified = false

          // Get pdfjs text items for position data (needed for whiteout fallback)
          const pdfjsDoc = pdfDoc  // use the existing pdfjs doc

          for (const pageState of pagesWithEdits) {
            const edits = pageState._textLayerEdits
            const streamData = getPageContentBytes(doc, pageState.pageIndex)

            if (streamData) {
              const parsed = parseContentStream(streamData.bytes)
              let streamModified = false
              const whiteoutEdits: typeof edits = []

              for (const edit of edits) {
                const run = parsed.textRuns[edit.spanIndex]
                if (!run) { whiteoutEdits.push(edit); continue }

                // Detect CMap-encoded runs: hex strings with non-printable bytes
                // are glyph IDs, not readable text. Can't re-encode without a CMap.
                const isHex = run.rawString?.type === 'hex'
                let isCMap = false
                if (isHex && run.rawString?.value) {
                  const raw = run.rawString.value
                  let nonPrintable = 0
                  for (let b = 0; b < raw.length; b++) {
                    if (raw[b] < 0x20 || raw[b] > 0x7E) nonPrintable++
                  }
                  isCMap = nonPrintable / raw.length > 0.2
                }

                if (isCMap) {
                  // CMap font — can't re-encode, use whiteout+redraw
                  whiteoutEdits.push(edit)
                } else {
                  // Standard encoding — direct content stream replacement
                  const newBytes = encodeTextToBytes(edit.newText)
                  applyTextReplacement(parsed, run.opIndex, newBytes, run.tjElementIndex)
                  streamModified = true
                }
              }

              if (streamModified) {
                const newBytes = serializeContentStream(parsed.operators, streamData.bytes)
                writePageContentBytes(streamData.stream, newBytes, true)
                anyModified = true
              }

              // Handle whiteout fallback for CMap-encoded edits
              if (whiteoutEdits.length > 0 && pdfjsDoc) {
                try {
                  const { items, pageHeight } = await extractTextItems(pdfjsDoc, pageState.pageIndex)
                  const pdfPage = doc.getPage(pageState.pageIndex)
                  const font = await doc.embedFont(StandardFonts.Helvetica)
                  const { height: pdfH } = pdfPage.getSize()

                  for (const edit of whiteoutEdits) {
                    // Find the matching pdfjs text item by index
                    const item = items[edit.spanIndex]
                    if (!item) continue

                    // Whiteout: draw white rect over original text
                    const pad = item.height * 0.15
                    pdfPage.drawRectangle({
                      x: item.x - pad,
                      y: item.y - pad,
                      width: item.width + pad * 2,
                      height: item.height + pad * 2,
                      color: rgb(1, 1, 1),
                      opacity: 1,
                    })

                    // Redraw: new text at same position
                    if (edit.newText.trim()) {
                      const fontSize = Math.max(8, Math.min(item.fontSize, 36))
                      pdfPage.drawText(edit.newText, {
                        x: item.x,
                        y: item.y,
                        size: fontSize,
                        font,
                        color: rgb(0, 0, 0),
                      })
                    }
                  }
                  anyModified = true
                } catch (err) {
                  console.error('Whiteout fallback failed:', err)
                }
              }
            }
          }

          if (anyModified) {
            const savedBytes = await doc.save()
            useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
              ...prev,
              pdfBytes: new Uint8Array(savedBytes),
              pages: prev.pages.map(p => {
                const { _textLayerEdits, ...rest } = p as any
                return rest
              })
            }))
            useTabStore.getState().setTabDirty(tabId, true)
          }
        } catch (err) {
          console.error('Failed to apply text edits:', err)
        }
      })()
    }
  }, [tool, tabId])
  const [fabricCanvas, setFabricCanvas] = useState<unknown>(null)

  // Poll for the current page's fabric canvas when layers panel is open
  useEffect(() => {
    if (!showLayers) { setFabricCanvas(null); return }
    let cancelled = false
    const poll = () => {
      if (cancelled) return
      const els = [...document.querySelectorAll('canvas.lower-canvas')] as Element[]
      for (const el of els) {
        const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'))
        if (!fiberKey) continue
        let fiber: any = (el as any)[fiberKey]
        while (fiber) {
          let hook = fiber.memoizedState
          while (hook) {
            const val = hook.memoizedState
            if (val && typeof val === 'object' && 'current' in val) {
              const cur = val.current
              if (cur && typeof cur.add === 'function' && typeof cur.toJSON === 'function' && cur.width > 400) {
                setFabricCanvas(cur)
                return
              }
            }
            hook = hook.next
          }
          fiber = fiber.return
        }
      }
      setTimeout(poll, 200)
    }
    poll()
    return () => { cancelled = true }
  }, [showLayers, currentPage])

  // Viewer feature flags (eye protection, auto-scroll, hide annotations)
  const eyeProtection = useViewerFeatures((s) => s.eyeProtection)
  const autoScroll = useViewerFeatures((s) => s.autoScroll)
  const autoScrollSpeed = useViewerFeatures((s) => s.autoScrollSpeed)
  const hideAnnotations = useViewerFeatures((s) => s.hideAnnotations)

  // Install / cancel auto-scroll interval on the viewport container
  useEffect(() => {
    installAutoScroll(containerRef.current, autoScrollSpeed, autoScroll)
    return () => installAutoScroll(null, 0, false)
  }, [autoScroll, autoScrollSpeed])

  // Toggle a class on the container so a stylesheet rule can hide the
  // fabric upper-canvas layer (annotations) without unmounting it.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.classList.toggle('satchel-hide-annotations', hideAnnotations)
  }, [hideAnnotations])

  const visiblePages = state?.pages.filter((p) => !p.deleted) ?? []

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.pageDisplayIndex)
            if (!isNaN(idx)) setCurrentPage(idx)
          }
        }
      },
      { root: container, threshold: 0.5 }
    )
    const pageEls = container.querySelectorAll('[data-page-display-index]')
    pageEls.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [visiblePages.length, setCurrentPage])

  // Ctrl+F to toggle search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        useUIStore.getState().toggleSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSearch = useCallback(async (query: string, _matchIndex: number) => {
    if (!pdfDoc || query.length < 2) { setSearchMatches(0); return }
    let total = 0
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const textContent = await page.getTextContent()
      const text = textContent.items.map((item: any) => item.str).join(' ')
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const matches = text.match(regex)
      if (matches) total += matches.length
      page.cleanup()
    }
    setSearchMatches(total)
  }, [pdfDoc])

  if (!pdfDoc || !state) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading PDF...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <PdfSearchBar
          visible={searchVisible}
          onClose={() => setSearchVisible(false)}
          onSearch={handleSearch}
          totalMatches={searchMatches}
        />
        <div
          ref={containerRef}
          data-testid="pdf-viewer-scroll"
          style={{
            overflow: 'auto', height: '100%', width: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0',
            filter: eyeProtection ? EYE_PROTECTION_FILTER : undefined,
          }}
        >
          {visiblePages.map((page, displayIndex) => (
            <PageRenderer
              key={page.pageIndex}
              tabId={tabId}
              pdfDoc={pdfDoc}
              pageIndex={page.pageIndex}
              displayIndex={displayIndex}
              rotation={page.rotation}
            />
          ))}
        </div>
      </div>
      {showLayers && (
        <div style={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--border)', overflow: 'auto', background: 'var(--bg-primary)', padding: 6 }}>
          <LayersPanel fabricCanvas={fabricCanvas as Parameters<typeof LayersPanel>[0]['fabricCanvas']} />
        </div>
      )}
    </div>
  )
}
