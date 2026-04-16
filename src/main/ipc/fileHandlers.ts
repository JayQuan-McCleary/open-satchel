import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { readdirSync, statSync } from 'fs'
import { join, extname, basename } from 'path'
import {
  openFileDialog,
  openFilePath,
  savePdf,
  saveAsPdfDialog,
  pickImagesDialog,
  openMultiplePdfsDialog
} from '../services/fileService'
import {
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles
} from '../services/recentFiles'

export function registerFileHandlers(): void {
  ipcMain.handle('file:open', async () => {
    return openFileDialog()
  })

  ipcMain.handle('file:openPath', async (_event, path: string) => {
    return openFilePath(path)
  })

  ipcMain.handle('file:save', async (_event, bytes: Uint8Array, path: string) => {
    await savePdf(bytes, path)
  })

  ipcMain.handle('file:saveAs', async (_event, bytes: Uint8Array) => {
    return saveAsPdfDialog(bytes)
  })

  ipcMain.handle('file:pickImages', async () => {
    return pickImagesDialog()
  })

  ipcMain.handle('file:openMultiple', async () => {
    return openMultiplePdfsDialog()
  })

  // Folder walk — recursively find PDFs in a directory
  ipcMain.handle('file:pickFolder', async (_event, extensions?: string[]) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select Folder',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const exts = new Set((extensions || ['.pdf']).map(e => e.toLowerCase()))
    const files: { path: string; name: string; bytes: Uint8Array }[] = []
    const walk = (dir: string) => {
      try {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          try {
            const stat = statSync(full)
            if (stat.isDirectory()) walk(full)
            else if (exts.has(extname(full).toLowerCase())) {
              files.push({ path: full, name: basename(full), bytes: new Uint8Array() })
            }
          } catch { /* skip inaccessible */ }
        }
      } catch { /* skip inaccessible */ }
    }
    walk(result.filePaths[0])
    // Load file bytes (up to 100 files to avoid memory issues)
    for (let i = 0; i < Math.min(files.length, 100); i++) {
      try { files[i].bytes = new Uint8Array(await readFile(files[i].path)) } catch { /* skip */ }
    }
    return files
  })

  // Native print via Electron
  ipcMain.handle('print:pdf', async (_event, opts?: { silent?: boolean; printBackground?: boolean; copies?: number }) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false
    return new Promise<boolean>((resolve) => {
      win.webContents.print({
        silent: opts?.silent ?? false,
        printBackground: opts?.printBackground ?? true,
        copies: opts?.copies ?? 1,
      }, (success) => resolve(success))
    })
  })

  // Desktop screen capture
  ipcMain.handle('capture:screen', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const img = await win.webContents.capturePage()
    return img.toPNG()
  })

  // Recent files
  ipcMain.handle('recent:get', async () => {
    return getRecentFiles()
  })

  ipcMain.handle('recent:add', async (_event, path: string, name: string, format: string) => {
    await addRecentFile(path, name, format)
  })

  ipcMain.handle('recent:remove', async (_event, path: string) => {
    await removeRecentFile(path)
  })

  ipcMain.handle('recent:clear', async () => {
    await clearRecentFiles()
  })
}
