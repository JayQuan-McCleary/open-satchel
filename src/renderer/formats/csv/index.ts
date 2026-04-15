import type { FormatHandler } from '../types'
import CsvViewer from './CsvViewer'
import { useFormatStore } from '../../stores/formatStore'

export interface CsvFormatState {
  rows: string[][]
  headers: string[]
  delimiter: string
  originalContent: string
}

function parseCsv(content: string, delimiter: string = ','): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }

  const parse = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue }
      if (char === delimiter && !inQuotes) { result.push(current.trim()); current = ''; continue }
      current += char
    }
    result.push(current.trim())
    return result
  }

  const headers = parse(lines[0])
  const rows = lines.slice(1).map(parse)
  return { headers, rows }
}

export const csvHandler: FormatHandler = {
  format: 'csv',
  extensions: ['csv', 'tsv'],
  displayName: 'CSV',
  icon: '📋',
  Viewer: CsvViewer,

  load: async (tabId, bytes, filePath) => {
    const content = new TextDecoder().decode(bytes)
    const delimiter = filePath.endsWith('.tsv') ? '\t' : ','
    const { headers, rows } = parseCsv(content, delimiter)

    const state: CsvFormatState = { rows, headers, delimiter, originalContent: content }
    useFormatStore.getState().setFormatState(tabId, state)
  },

  save: async (tabId) => {
    const state = useFormatStore.getState().getFormatState<CsvFormatState>(tabId)
    if (!state) throw new Error('No CSV state')

    const escape = (val: string) => {
      if (val.includes(state.delimiter) || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    }

    const headerLine = state.headers.map(escape).join(state.delimiter)
    const dataLines = state.rows.map((row) => row.map(escape).join(state.delimiter))
    const content = [headerLine, ...dataLines].join('\n')
    return new TextEncoder().encode(content)
  },

  cleanup: (tabId) => useFormatStore.getState().clearFormatState(tabId),

  canConvertTo: ['xlsx', 'pdf'],
  capabilities: { edit: true, annotate: false, search: true, zoom: false }
}
