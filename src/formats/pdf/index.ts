import type { FormatHandler } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import PdfViewer from './PdfViewer'
import PdfSidebar from './PdfSidebar'

// Per-tab PDF state. Keeping this lean for M1 — the Electron codebase had
// per-page rotation/deleted flags, Fabric JSON, and form values; those
// come back in M2 and M3 as we port the ribbon features.
export interface PdfFormatState {
  bytes: Uint8Array
  pageCount: number
  /** Loaded pdfjs document — kept as `unknown` to avoid leaking pdfjs types
   *  into non-PDF code. The viewer casts back. */
  doc: unknown
  currentPage: number
  scale: number
}

export const pdfHandler: FormatHandler = {
  format: 'pdf',
  extensions: ['pdf'],
  displayName: 'PDF',
  icon: '📄',
  Viewer: PdfViewer,
  Sidebar: PdfSidebar,

  load: async (tabId, bytes) => {
    // Dynamic import keeps pdfjs (~1MB) out of the initial bundle.
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    // Set only once; subsequent loads reuse it.
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

    const doc = await pdfjs.getDocument({ data: bytes }).promise
    useFormatStore.getState().setFormatState<PdfFormatState>(tabId, {
      bytes,
      pageCount: doc.numPages,
      doc,
      currentPage: 1,
      scale: 1.25,
    })
  },

  save: async (tabId) => {
    const s = useFormatStore.getState().getFormatState<PdfFormatState>(tabId)
    if (!s) throw new Error('No PDF state')
    return s.bytes
  },

  cleanup: (tabId) => {
    const s = useFormatStore.getState().getFormatState<PdfFormatState>(tabId)
    // pdfjs's PDFDocumentProxy.destroy() releases the worker-side doc.
    if (s && (s.doc as { destroy?: () => Promise<void> })?.destroy) {
      void (s.doc as { destroy: () => Promise<void> }).destroy()
    }
    useFormatStore.getState().clearFormatState(tabId)
  },

  canConvertTo: [],
  capabilities: { edit: false, annotate: false, search: true, zoom: true },
}

