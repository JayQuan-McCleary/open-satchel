import { ipcMain } from 'electron'
import { mergePdfs, splitPdf } from '../services/pdfService'

export function registerPdfHandlers(): void {
  ipcMain.handle('pdf:merge', async (_event, bytesArray: Uint8Array[]) => {
    return mergePdfs(bytesArray)
  })

  ipcMain.handle('pdf:split', async (_event, bytes: Uint8Array, ranges: [number, number][]) => {
    return splitPdf(bytes, ranges)
  })
}
