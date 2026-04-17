// Format taxonomy for v1. Ten formats shipped, 25 deferred (see
// DEFERRED_FORMATS.md at the project root).

export type DocumentFormat =
  | 'pdf'
  | 'markdown'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'code'       // source code + plain text
  | 'csv'
  | 'json'
  | 'html'
  | 'image'

export interface TabDescriptor {
  id: string
  filePath: string | null
  fileName: string
  format: DocumentFormat
  isDirty: boolean
}

export const FORMAT_NAMES: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  docx: 'Word Document',
  xlsx: 'Spreadsheet',
  pptx: 'Presentation',
  code: 'Code / Text',
  csv: 'CSV',
  json: 'JSON',
  html: 'HTML',
  image: 'Image',
}

export const FORMAT_ICONS: Record<DocumentFormat, string> = {
  pdf: '📄',
  markdown: '📑',
  docx: '📝',
  xlsx: '📊',
  pptx: '📽',
  code: '💻',
  csv: '📋',
  json: '{}',
  html: '🌐',
  image: '🖼',
}

// Extension → format. Keep this tight; no fallbacks here, the caller
// decides what to do with unknown extensions.
const EXTENSION_MAP: Record<string, DocumentFormat> = {
  // PDF
  '.pdf': 'pdf',
  // Markdown
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  // Office
  '.docx': 'docx',
  '.doc': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.xlsm': 'xlsx',
  '.pptx': 'pptx',
  '.ppt': 'pptx',
  // CSV / TSV
  '.csv': 'csv',
  '.tsv': 'csv',
  // JSON family
  '.json': 'json',
  '.json5': 'json',
  '.jsonc': 'json',
  '.jsonl': 'json',
  '.ndjson': 'json',
  // HTML
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  // Images
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.webp': 'image',
  '.ico': 'image',
  // Code / plaintext — big list, all treated the same by the code handler
  '.js': 'code',
  '.jsx': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.py': 'code',
  '.rb': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.java': 'code',
  '.kt': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.hpp': 'code',
  '.cs': 'code',
  '.php': 'code',
  '.swift': 'code',
  '.sh': 'code',
  '.bash': 'code',
  '.zsh': 'code',
  '.ps1': 'code',
  '.sql': 'code',
  '.r': 'code',
  '.lua': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.less': 'code',
  '.vue': 'code',
  '.svelte': 'code',
  '.bat': 'code',
  '.cmd': 'code',
  '.toml': 'code',
  '.yaml': 'code',
  '.yml': 'code',
  '.xml': 'code',
  '.txt': 'code',
  '.log': 'code',
  '.ini': 'code',
  '.conf': 'code',
  '.env': 'code',
}

export function detectFormat(filePath: string): DocumentFormat | null {
  const lower = filePath.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  const ext = lower.slice(dot)
  return EXTENSION_MAP[ext] ?? null
}

export function getAllSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP).map((e) => e.slice(1))
}
