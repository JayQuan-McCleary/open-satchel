;(globalThis as Record<string, unknown>).window = {
  api: {
    font: {
      listSystem: async () => [],
      getBytes: async () => new Uint8Array(),
    },
  },
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
;(pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
  new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

import { clusterParagraphs } from '../src/services/pdfParagraphs.js'

const pageArg = Number(process.argv[2] ?? '1')
const bytes = new Uint8Array(fs.readFileSync(path.join(os.homedir(), 'Desktop', 'open-satchel-stress.pdf')))
const doc = await pdfjsLib.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise
const res = await clusterParagraphs(doc, pageArg - 1)
console.log(`Page ${pageArg} paragraphs (${res.paragraphs.length}):`)
for (const p of res.paragraphs) {
  console.log(`  [x=${p.bbox.x.toFixed(0).padStart(3)} y=${p.bbox.y.toFixed(0).padStart(3)} w=${p.bbox.width.toFixed(0).padStart(3)}] ${JSON.stringify(p.originalText.trim().slice(0, 70))}`)
}
