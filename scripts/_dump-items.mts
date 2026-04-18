;(globalThis as Record<string, unknown>).window = {
  api: { font: { listSystem: async () => [], getBytes: async () => new Uint8Array() } },
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
;(pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
  new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const bytes = new Uint8Array(fs.readFileSync(path.join(os.homedir(), 'Desktop', 'open-satchel-stress.pdf')))
const doc = await pdfjsLib.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise
const pageArg = Number(process.argv[2] ?? '1')
const searchStr = process.argv[3]
const page = await doc.getPage(pageArg)
const tc = await page.getTextContent()
console.log(`Page ${pageArg} raw text items (${tc.items.length}):`)
for (const item of tc.items as Array<{ str: string; transform: number[]; width: number }>) {
  if (searchStr && !item.str.includes(searchStr)) continue
  const [a, , , d, e, f] = item.transform
  console.log(`  at (${e.toFixed(0).padStart(3)}, ${f.toFixed(0).padStart(3)}) w=${item.width.toFixed(0).padStart(4)} fontSize=${Math.abs(d).toFixed(0)} ${JSON.stringify(item.str)}`)
}
