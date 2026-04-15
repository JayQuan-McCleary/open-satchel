import type { FormatHandler } from '../types'
import PdfViewer from './PdfViewer'
import PdfSidebar from './PdfSidebar'
import PdfToolbar from './PdfToolbar'
import { useFormatStore } from '../../stores/formatStore'
import { serializeEditsToPdf } from '../../services/editSerializer'
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
    return serializeEditsToPdf(state.pdfBytes, state.pages, zoom, {
      encryption: state.encryption,
      headerFooter: state.headerFooter
    })
  },

  cleanup: (tabId) => {
    useFormatStore.getState().clearFormatState(tabId)
  },

  canConvertTo: ['image'],
  capabilities: { edit: true, annotate: true, search: true, zoom: true }
}
