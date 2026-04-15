export type DocumentFormat =
  | 'pdf'
  | 'image'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'markdown'
  | 'code'
  | 'csv'
  | 'rtf'
  | 'epub'
  | 'html'
  | 'plaintext'

export interface TabDescriptor {
  id: string
  filePath: string | null
  fileName: string
  format: DocumentFormat
  isDirty: boolean
}

export const FORMAT_ICONS: Record<DocumentFormat, string> = {
  pdf: '📄',
  image: '🖼',
  docx: '📝',
  xlsx: '📊',
  pptx: '📽',
  markdown: '📑',
  code: '💻',
  csv: '📋',
  rtf: '📃',
  epub: '📖',
  html: '🌐',
  plaintext: '📝'
}

export const FORMAT_NAMES: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  image: 'Image',
  docx: 'Word Document',
  xlsx: 'Spreadsheet',
  pptx: 'Presentation',
  markdown: 'Markdown',
  code: 'Code',
  csv: 'CSV',
  rtf: 'Rich Text',
  epub: 'eBook',
  html: 'HTML',
  plaintext: 'Plain Text'
}

const EXTENSION_MAP: Record<string, DocumentFormat> = {
  // PDF
  '.pdf': 'pdf',
  // Images
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image',
  '.bmp': 'image', '.webp': 'image', '.svg': 'image', '.tiff': 'image', '.tif': 'image', '.ico': 'image',
  // Office
  '.docx': 'docx', '.doc': 'docx',
  '.xlsx': 'xlsx', '.xls': 'xlsx',
  '.pptx': 'pptx', '.ppt': 'pptx',
  // Markdown
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
  // Code
  '.js': 'code', '.ts': 'code', '.jsx': 'code', '.tsx': 'code',
  '.py': 'code', '.rb': 'code', '.go': 'code', '.rs': 'code',
  '.java': 'code', '.c': 'code', '.cpp': 'code', '.h': 'code',
  '.cs': 'code', '.php': 'code', '.swift': 'code', '.kt': 'code',
  '.sh': 'code', '.bash': 'code', '.zsh': 'code', '.ps1': 'code',
  '.sql': 'code', '.r': 'code', '.lua': 'code', '.perl': 'code',
  '.yaml': 'code', '.yml': 'code', '.toml': 'code', '.ini': 'code',
  '.xml': 'code', '.json': 'code', '.jsonc': 'code',
  '.css': 'code', '.scss': 'code', '.less': 'code',
  '.vue': 'code', '.svelte': 'code',
  '.dockerfile': 'code', '.makefile': 'code',
  '.env': 'code', '.gitignore': 'code',
  '.bat': 'code', '.cmd': 'code',
  // CSV
  '.csv': 'csv', '.tsv': 'csv',
  // RTF
  '.rtf': 'rtf',
  // ePub
  '.epub': 'epub',
  // HTML
  '.html': 'html', '.htm': 'html',
  // Plain text
  '.txt': 'plaintext', '.log': 'plaintext', '.cfg': 'plaintext',
  '.conf': 'plaintext', '.properties': 'plaintext'
}

export function detectFormat(filePath: string): DocumentFormat {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase()
  return EXTENSION_MAP[ext] || 'plaintext'
}

export function getAllSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP).map((ext) => ext.slice(1))
}
