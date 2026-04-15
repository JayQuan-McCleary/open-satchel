import { ipcMain } from 'electron'
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
