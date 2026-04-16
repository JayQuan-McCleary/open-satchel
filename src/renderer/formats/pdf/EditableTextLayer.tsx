// Editable Text Layer — renders PDF text as individually editable DOM spans.
// Uses pdfjs TextLayer positioning (pixel-perfect, battle-tested since 2011)
// but makes each text run contenteditable for inline editing.
//
// On save, modified text is written back to the PDF content stream via
// the content stream parser — true editing, not overlay.

import { useEffect, useRef, useState, useCallback } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfFormatState } from './index'
import { useFormatStore } from '../../stores/formatStore'
import { useTabStore } from '../../stores/tabStore'

interface Props {
  tabId: string
  pageIndex: number
  pdfDoc: PDFDocumentProxy
  width: number    // display width in px
  height: number   // display height in px
}

interface TextEdit {
  spanIndex: number
  originalText: string
  newText: string
}

export default function EditableTextLayer({ tabId, pageIndex, pdfDoc, width, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editsRef = useRef<Map<number, TextEdit>>(new Map())
  const [ready, setReady] = useState(false)

  // Render the text layer with pdfjs TextLayer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false

    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1)
        if (cancelled) { page.cleanup(); return }

        const viewport = page.getViewport({ scale: 1 })
        const textContent = await page.getTextContent()
        if (cancelled) { page.cleanup(); return }

        // Clear previous content
        container.innerHTML = ''
        editsRef.current.clear()

        // Set the CSS variable pdfjs uses for scaling
        const scaleFactor = width / viewport.width
        container.style.setProperty('--scale-factor', String(scaleFactor))

        // Create the text layer
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        })

        await textLayer.render()
        if (cancelled) { page.cleanup(); return }

        // Make each text span editable and track changes
        const divs = textLayer.textDivs
        divs.forEach((div, idx) => {
          const originalText = div.textContent || ''
          if (!originalText.trim()) return

          // Make editable
          div.contentEditable = 'true'
          div.spellcheck = false
          div.style.cursor = 'text'

          // Track edits on every keystroke so they're always in the store
          div.addEventListener('input', () => {
            const newText = div.textContent || ''
            if (newText !== originalText) {
              editsRef.current.set(idx, { spanIndex: idx, originalText, newText })
            } else {
              editsRef.current.delete(idx)
            }
            saveEditsToStore()
          })
        })

        page.cleanup()
        setReady(true)
      } catch (err) {
        console.error('EditableTextLayer render failed:', err)
      }
    }

    render()
    return () => { cancelled = true }
  }, [pdfDoc, pageIndex, width, height])

  // Save the current edits to the format store so the save pipeline can access them
  const saveEditsToStore = useCallback(() => {
    const edits = Array.from(editsRef.current.values())
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => {
      const pages = prev.pages.map((p) => {
        if (p.pageIndex !== pageIndex) return p
        return { ...p, _textLayerEdits: edits.length > 0 ? edits : undefined } as any
      })
      return { ...prev, pages }
    })
    if (editsRef.current.size > 0) {
      useTabStore.getState().setTabDirty(tabId, true)
    }
  }, [tabId, pageIndex])

  // Edit application is handled by PdfViewer when tool changes away from edit_text.

  return (
    <>
      <style>{`
        [data-testid="editable-text-layer"] span {
          position: absolute;
          white-space: pre;
          transform-origin: 0% 0%;
          color: transparent;
          pointer-events: auto;
          caret-color: #000;
        }
        [data-testid="editable-text-layer"] span:focus {
          color: #000 !important;
          background: rgba(255,255,255,0.92);
          outline: 1px solid #89b4fa;
          z-index: 10;
        }
        [data-testid="editable-text-layer"] span:hover:not(:focus) {
          background: rgba(137,180,250,0.1);
        }
        [data-testid="editable-text-layer"] br {
          display: none;
        }
      `}</style>
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          zIndex: 5,
          lineHeight: 1.0,
          opacity: 1,
          overflow: 'hidden',
          background: 'transparent',
        }}
        data-testid="editable-text-layer"
      />
    </>
  )
}
