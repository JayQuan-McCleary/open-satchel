import { ipcMain } from 'electron'
import {
  getInstalledFonts,
  importFont,
  getFontBytes,
  removeFont
} from '../services/fontService'

export function registerFontHandlers(): void {
  ipcMain.handle('font:list', async () => {
    return getInstalledFonts()
  })

  ipcMain.handle('font:import', async () => {
    return importFont()
  })

  ipcMain.handle('font:getBytes', async (_event, fontId: string) => {
    return getFontBytes(fontId)
  })

  ipcMain.handle('font:remove', async (_event, fontId: string) => {
    await removeFont(fontId)
  })
}
