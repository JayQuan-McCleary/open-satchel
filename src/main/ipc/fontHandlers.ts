import { ipcMain } from 'electron'
import subsetFont from 'subset-font'
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

  ipcMain.handle('font:subset', async (_event, fontId: string, glyphs: string) => {
    try {
      const bytes = await getFontBytes(fontId)
      if (!bytes || bytes.byteLength === 0 || !glyphs) return bytes
      const subset = await subsetFont(Buffer.from(bytes), glyphs, { targetFormat: 'sfnt' })
      return new Uint8Array(subset)
    } catch {
      // Subsetting failed — return full font bytes as fallback
      return getFontBytes(fontId)
    }
  })
}
