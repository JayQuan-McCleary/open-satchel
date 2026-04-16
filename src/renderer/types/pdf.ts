export interface PageState {
  pageIndex: number
  rotation: 0 | 90 | 180 | 270
  deleted: boolean
  fabricJSON: Record<string, unknown> | null
  formValues: Record<string, string | boolean> | null
}

export interface DocumentState {
  pdfBytes: Uint8Array | null
  filePath: string | null
  fileName: string | null
  isDirty: boolean
  pageCount: number
  pages: PageState[]
}

export type Tool =
  | 'select'
  | 'text'
  | 'draw'
  | 'image'
  | 'signature'
  | 'form'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'redact'
  | 'shape_rect'
  | 'shape_circle'
  | 'shape_line'
  | 'shape_arrow'
  | 'sticky_note'
  | 'stamp'
  // New WPS-parity tools:
  | 'wipe_off'
  | 'highlight_area'
  | 'textbox_note'
  | 'link'
  | 'audio'
  | 'video'
  | 'insert_text_marker'
  | 'replace_text_marker'
  | 'measure'
  | 'form_designer'
  | 'edit_text'
  // Fill & Sign quick-stamps
  | 'fill_cross'
  | 'fill_check'
  | 'fill_circle'
  | 'fill_line'
  | 'fill_dot'
  | 'fill_date'
  | 'fill_initials'
  | 'fill_timestamp'

export interface DrawingOptions {
  color: string
  width: number
  opacity: number
}

export interface TextOptions {
  fontFamily: string
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  textAlign: 'left' | 'center' | 'right'
  lineHeight: number
  charSpacing: number
  customFontId?: string
}

export interface UIState {
  currentPage: number
  zoom: number
  tool: Tool
  sidebarOpen: boolean
  drawingOptions: DrawingOptions
  textOptions: TextOptions
  highlightColor: string
  shapeColor: string
  shapeStrokeWidth: number
  noteColor: string
  selectedStamp: number
  initials: string
  searchVisible: boolean
  theme: 'dark' | 'light'
  commandPaletteOpen: boolean
  findReplaceOpen: boolean
  findReplaceMode: 'find' | 'replace'
  autoSaveEnabled: boolean
  autoSaveInterval: number
  autoSaveStatus: 'idle' | 'saving' | 'saved'
  showRulers: boolean
  showGrid: boolean
  showLayers: boolean
}
