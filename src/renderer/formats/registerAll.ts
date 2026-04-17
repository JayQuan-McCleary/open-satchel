import { registerFormat } from './registry'
import { pdfHandler } from './pdf/index'
import { imageHandler } from './image/index'
import { codeHandler, plaintextHandler } from './code/index'
import { markdownHandler } from './markdown/index'
import { csvHandler } from './csv/index'
import { htmlHandler } from './html/index'
import { docxHandler } from './docx/index'
import { xlsxHandler } from './xlsx/index'
// New formats
import {
  jsonHandler, yamlHandler, tomlHandler, xmlHandler,
  logHandler, diffHandler, iniHandler, bibHandler, texHandler
} from './text/index'
import { archiveHandler } from './archive/index'
import { rtfHandler, fb2Handler } from './richtext/index'
import { emailHandler, mboxHandler } from './email/index'
import {
  svgHandler, tiffHandler, heicHandler, sqliteHandler, jupyterHandler,
  certHandler, subtitleHandler, fontHandler, djvuHandler, mobiHandler
} from './specialty/index'

export function registerAllFormats(): void {
  // Existing formats
  registerFormat(pdfHandler)
  registerFormat(imageHandler)
  registerFormat(codeHandler)
  registerFormat(plaintextHandler)
  registerFormat(markdownHandler)
  registerFormat(csvHandler)
  registerFormat(htmlHandler)
  registerFormat(docxHandler)
  registerFormat(xlsxHandler)
  // Text/structured data
  registerFormat(jsonHandler)
  registerFormat(yamlHandler)
  registerFormat(tomlHandler)
  registerFormat(xmlHandler)
  registerFormat(logHandler)
  registerFormat(diffHandler)
  registerFormat(iniHandler)
  registerFormat(bibHandler)
  registerFormat(texHandler)
  // Archives
  registerFormat(archiveHandler)
  // Rich text / ebooks
  registerFormat(rtfHandler)
  registerFormat(fb2Handler)
  // Email
  registerFormat(emailHandler)
  registerFormat(mboxHandler)
  // Images
  registerFormat(svgHandler)
  registerFormat(tiffHandler)
  registerFormat(heicHandler)
  // Specialty
  registerFormat(sqliteHandler)
  registerFormat(jupyterHandler)
  registerFormat(certHandler)
  registerFormat(subtitleHandler)
  registerFormat(fontHandler)
  registerFormat(djvuHandler)
  registerFormat(mobiHandler)
}
