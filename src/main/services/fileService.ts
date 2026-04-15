import { dialog, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'

const ALL_SUPPORTED_FILTERS = [
  {
    name: 'All Supported Files',
    extensions: [
      'pdf',
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif', 'ico',
      'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
      'md', 'markdown', 'mdx',
      'txt', 'log', 'cfg', 'conf',
      'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
      'cs', 'php', 'swift', 'kt', 'sh', 'bash', 'sql',
      'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'xml',
      'css', 'scss', 'less', 'html', 'htm',
      'csv', 'tsv', 'rtf', 'epub',
      'vue', 'svelte', 'bat', 'cmd', 'ps1'
    ]
  },
  { name: 'PDF Files', extensions: ['pdf'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif'] },
  { name: 'Office Documents', extensions: ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'] },
  { name: 'Text & Code', extensions: ['txt', 'md', 'js', 'ts', 'py', 'json', 'html', 'css', 'xml', 'yaml', 'yml'] },
  { name: 'CSV/TSV', extensions: ['csv', 'tsv'] },
  { name: 'All Files', extensions: ['*'] }
]

export async function openFileDialog(): Promise<{ bytes: Uint8Array; path: string } | null> {
  const window = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(window!, {
    title: 'Open File',
    filters: ALL_SUPPORTED_FILTERS,
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const buffer = await readFile(filePath)
  return { bytes: new Uint8Array(buffer), path: filePath }
}

export async function savePdf(bytes: Uint8Array, path: string): Promise<void> {
  await writeFile(path, Buffer.from(bytes))
}

export async function saveAsPdfDialog(bytes: Uint8Array): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow()
  const result = await dialog.showSaveDialog(window!, {
    title: 'Save As',
    filters: [{ name: 'All Files', extensions: ['*'] }]
  })

  if (result.canceled || !result.filePath) return null

  await writeFile(result.filePath, Buffer.from(bytes))
  return result.filePath
}

export async function openFilePath(filePath: string): Promise<{ bytes: Uint8Array; path: string }> {
  const buffer = await readFile(filePath)
  return { bytes: new Uint8Array(buffer), path: filePath }
}

export async function openMultiplePdfsDialog(): Promise<{ bytes: Uint8Array; path: string }[] | null> {
  const window = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(window!, {
    title: 'Select PDFs to Merge',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const files = await Promise.all(
    result.filePaths.map(async (filePath) => {
      const buffer = await readFile(filePath)
      return { bytes: new Uint8Array(buffer), path: filePath }
    })
  )
  return files
}

export async function pickImagesDialog(): Promise<{ bytes: Uint8Array; name: string }[] | null> {
  const window = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(window!, {
    title: 'Select Images',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }
    ],
    properties: ['openFile', 'multiSelections']
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const files = await Promise.all(
    result.filePaths.map(async (filePath) => {
      const buffer = await readFile(filePath)
      const name = filePath.split(/[/\\]/).pop() || 'image'
      return { bytes: new Uint8Array(buffer), name }
    })
  )
  return files
}
