import type { FormatHandler } from '../types'
import PdfViewer from './PdfViewer'
import PdfSidebar from './PdfSidebar'
import PdfToolbar from './PdfToolbar'
import { useFormatStore } from '../../stores/formatStore'
import { serializeEditsToPdf } from '../../services/editSerializer'
import { applyTextEditsToBytes, type TextLayerEdit } from '../../services/pdfTextEdits'
import { applyParagraphEditsToBytes, type ParagraphEdit } from '../../services/pdfParagraphEdits'
import { useUIStore } from '../../stores/uiStore'
import * as pdfjsLib from 'pdfjs-dist'

export interface PdfPageState {
  pageIndex: number
  rotation: 0 | 90 | 180 | 270
  deleted: boolean
  fabricJSON: Record<string, unknown> | null
  formValues: Record<string, string | boolean> | null
  pageSize?: { width: number; height: number }
}

export interface PdfFormatState {
  pdfBytes: Uint8Array
  pageCount: number
  pages: PdfPageState[]
  encryption?: { userPassword: string; ownerPassword: string }
  headerFooter?: HeaderFooterConfig
}

export interface HeaderFooterConfig {
  headerLeft: string; headerCenter: string; headerRight: string
  footerLeft: string; footerCenter: string; footerRight: string
  fontFamily: string; fontSize: number; color: string
  applyTo: 'all' | 'odd' | 'even'
  marginTop: number; marginBottom: number
}

export const pdfHandler: FormatHandler = {
  format: 'pdf',
  extensions: ['pdf'],
  displayName: 'PDF Document',
  icon: '📄',
  Viewer: PdfViewer,
  Sidebar: PdfSidebar,
  ToolbarExtras: PdfToolbar,

  load: async (tabId, bytes, _filePath) => {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const pageCount = doc.numPages
    doc.destroy()

    const pages: PdfPageState[] = Array.from({ length: pageCount }, (_, i) => ({
      pageIndex: i,
      rotation: 0,
      deleted: false,
      fabricJSON: null,
      formValues: null
    }))

    const state: PdfFormatState = { pdfBytes: bytes, pageCount, pages }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<PdfFormatState>(tabId)
    if (!state) throw new Error('No PDF state for tab')
    const zoom = useUIStore.getState().zoom

    // First pass: flush text-layer edits that EditableTextLayer accumulated
    // per-page. These need to land in pdfBytes BEFORE editSerializer runs,
    // because editSerializer handles Fabric annotations + page mods but
    // doesn't know about content-stream text edits.
    let workingBytes = state.pdfBytes
    const pdfjsDocForWhiteout = await (async () => {
      try {
        const doc = await pdfjsLib.getDocument({ data: workingBytes.slice() }).promise
        return doc
      } catch {
        return null
      }
    })()

    // Track which pages had paragraph edits so we can skip span-level
    // edits there (the whiteout already covered that region, and
    // serializeEditsToPdf's legacy internal path would otherwise
    // double-apply).
    const pagesWithParaEdits = new Set<number>()

    try {
      // 1a. Paragraph-level edits (new default, Acrobat-style)
      const fallback = (useUIStore.getState() as any).fallbackFontFamily as string | undefined
      for (const page of state.pages) {
        const paraEdits = (page as any)._paragraphEdits as ParagraphEdit[] | undefined
        if (!paraEdits || paraEdits.length === 0) continue
        workingBytes = await applyParagraphEditsToBytes(
          workingBytes,
          page.pageIndex,
          paraEdits,
          {
            fallbackFont: (fallback as any) || 'Helvetica',
            // Pass the pdfjs doc we opened above so applyParagraphEditsToBytes
            // can blank CMap-encoded runs via whiteout fallback inside
            // applyTextEditsToBytes. Without this, CMap fonts would leave
            // ghost text in the content stream.
            pdfjsDoc: pdfjsDocForWhiteout,
          },
        )
        pagesWithParaEdits.add(page.pageIndex)
      }

      // 1b. Span-level text edits (legacy fallback path). Skip pages
      // where paragraph edits already ran — those cover the same region.
      for (const page of state.pages) {
        if (pagesWithParaEdits.has(page.pageIndex)) continue
        const edits = (page as any)._textLayerEdits as TextLayerEdit[] | undefined
        if (!edits || edits.length === 0) continue
        workingBytes = await applyTextEditsToBytes(
          workingBytes,
          page.pageIndex,
          edits,
          pdfjsDocForWhiteout,
        )
      }
    } finally {
      if (pdfjsDocForWhiteout) await pdfjsDocForWhiteout.destroy()
    }

    // Clear _textLayerEdits on pages we handled via paragraph edits so
    // serializeEditsToPdf's internal legacy path doesn't re-apply them.
    // (This mutates the `pages` array we pass down, not state; state
    // clearing happens below after the save completes.)
    const pagesForSerializer = state.pages.map((p) => {
      if (!pagesWithParaEdits.has(p.pageIndex)) return p
      const { _textLayerEdits, ...rest } = p as any
      void _textLayerEdits
      return rest
    })

    // Second pass: Fabric objects, page rotations/deletions, header/footer,
    // encryption, everything else.
    const outBytes = await serializeEditsToPdf(workingBytes, pagesForSerializer, zoom, {
      encryption: state.encryption,
      headerFooter: state.headerFooter,
    })
    const outArray = outBytes instanceof Uint8Array ? outBytes : new Uint8Array(outBytes)

    // Sync the serialized bytes back into state. Without this, the canvas
    // keeps rendering the pre-save pdfBytes, so visually nothing changes
    // even though the file on disk has the edit. Also clear the pending
    // edit markers — they've all been flushed.
    useFormatStore.getState().updateFormatState<PdfFormatState>(tabId, (prev) => ({
      ...prev,
      pdfBytes: outArray,
      pages: prev.pages.map((p) => {
        const { _paragraphEdits, _textLayerEdits, ...rest } = p as any
        void _paragraphEdits
        void _textLayerEdits
        return rest
      }),
    }))

    return outArray
  },

  cleanup: (tabId) => {
    useFormatStore.getState().clearFormatState(tabId)
  },

  canConvertTo: ['image'],
  capabilities: { edit: true, annotate: true, search: true, zoom: true }
}
