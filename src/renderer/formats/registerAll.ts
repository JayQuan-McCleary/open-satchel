import { registerFormat } from './registry'
import { pdfHandler } from './pdf/index'
import { imageHandler } from './image/index'
import { codeHandler, plaintextHandler } from './code/index'
import { markdownHandler } from './markdown/index'
import { csvHandler } from './csv/index'
import { htmlHandler } from './html/index'
import { docxHandler } from './docx/index'
import { xlsxHandler } from './xlsx/index'

export function registerAllFormats(): void {
  registerFormat(pdfHandler)
  registerFormat(imageHandler)
  registerFormat(codeHandler)
  registerFormat(plaintextHandler)
  registerFormat(markdownHandler)
  registerFormat(csvHandler)
  registerFormat(htmlHandler)
  registerFormat(docxHandler)
  registerFormat(xlsxHandler)
}
