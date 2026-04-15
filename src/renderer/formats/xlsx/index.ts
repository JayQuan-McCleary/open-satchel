import * as XLSX from 'xlsx'
import type { FormatHandler } from '../types'
import { useFormatStore } from '../../stores/formatStore'
import XlsxEditor from './XlsxEditor'
import XlsxToolbar from './XlsxToolbar'

export interface XlsxSheetData {
  name: string
  data: string[][]
  colWidths: number[]
}

export interface XlsxFormatState {
  workbook: XLSX.WorkBook | null
  sheets: XlsxSheetData[]
  activeSheet: number
  selectedCell: { row: number; col: number } | null
  editingCell: { row: number; col: number } | null
}

function extractSheets(wb: XLSX.WorkBook): XlsxSheetData[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    const jsonData: string[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: ''
    }) as string[][]

    // Ensure at least 26 columns and 50 rows for a usable grid
    const minCols = 26
    const minRows = 50
    const maxCols = Math.max(minCols, ...jsonData.map((r) => r.length))
    const data = jsonData.map((row) => {
      const padded = [...row]
      while (padded.length < maxCols) padded.push('')
      return padded.map((c) => (c == null ? '' : String(c)))
    })
    while (data.length < minRows) {
      data.push(new Array(maxCols).fill(''))
    }

    // Extract column widths from sheet or default
    const colWidths: number[] = []
    const wsCols = ws['!cols'] || []
    for (let i = 0; i < maxCols; i++) {
      const w = wsCols[i]?.wpx ?? wsCols[i]?.wch ? (wsCols[i].wch! * 8) : 0
      colWidths.push(w > 0 ? w : 80)
    }

    return { name, data, colWidths }
  })
}

export const xlsxHandler: FormatHandler = {
  format: 'xlsx',
  extensions: ['xlsx', 'xls'],
  displayName: 'Spreadsheet',
  icon: '\u{1F4CA}',
  Viewer: XlsxEditor,
  ToolbarExtras: XlsxToolbar,

  load: async (tabId, bytes, _filePath) => {
    const wb = XLSX.read(bytes, { type: 'array' })
    const sheets = extractSheets(wb)

    // If workbook is empty, create a default sheet
    if (sheets.length === 0) {
      const minCols = 26
      const minRows = 50
      sheets.push({
        name: 'Sheet1',
        data: Array.from({ length: minRows }, () => new Array(minCols).fill('')),
        colWidths: new Array(minCols).fill(80)
      })
    }

    const state: XlsxFormatState = {
      workbook: wb,
      sheets,
      activeSheet: 0,
      selectedCell: { row: 0, col: 0 },
      editingCell: null
    }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<XlsxFormatState>(tabId)
    if (!state) throw new Error('No XLSX state')

    const wb = XLSX.utils.book_new()
    for (const sheet of state.sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.data)
      // Set column widths
      ws['!cols'] = sheet.colWidths.map((w) => ({ wpx: w }))
      XLSX.utils.book_append_sheet(wb, ws, sheet.name)
    }

    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    return new Uint8Array(wbOut)
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),

  canConvertTo: ['csv', 'pdf'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}
