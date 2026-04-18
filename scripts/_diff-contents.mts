// Diff the first 2000 bytes of the decompressed content stream between
// master and edited PDFs to diagnose what the save pipeline changed.

;(globalThis as Record<string, unknown>).window = {
  api: { font: { listSystem: async () => [], getBytes: async () => new Uint8Array() } },
}

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { getPageContentBytes } from '../src/services/contentStreamParser.js'

const master = path.join(os.homedir(), 'Desktop', 'open-satchel-stress.pdf')
const edited = process.argv[2] ?? 'test-pdfs/stress-edited-rename-segment.pdf'

async function dump(label: string, file: string) {
  const bytes = new Uint8Array(fs.readFileSync(file))
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents = (page.node as any).get((await import('pdf-lib')).PDFName.of('Contents'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolved = doc.context.lookup(contents) as any
  const isArray = resolved && typeof resolved.size === 'function'
  const streamCount = isArray ? resolved.size() : 1
  const stream = getPageContentBytes(doc, 0)
  if (!stream) { console.log(label + ': NO STREAM'); return }
  const text = new TextDecoder('latin1').decode(stream.bytes)
  console.log(`  Contents type: ${isArray ? 'PDFArray' : 'single stream'}  (${streamCount} stream${streamCount === 1 ? '' : 's'})`)
  // Count fill operators
  const fillCount = (text.match(/(^|\s)(f|f\*|B|B\*|b|b\*)\s/g) ?? []).length
  const textBlocks = (text.match(/BT[\s\S]*?ET/g) ?? []).length
  // Look for patterns like "40 532 cm" (navy table header setup)
  const hasNavyHeader = /40\s+532\s+cm/.test(text)
  // And the dark top band
  const hasDarkTop = /0\s+696\s+cm/.test(text)
  // Extract each `q ... Q` block (save/restore pairs that scope a drawing)
  // and count those that end with a fill op
  const qBlocks = text.split(/\bq\s/).slice(1)
  const filledBlocks = qBlocks.filter((b) => /\s(f|f\*)\s/.test(b.slice(0, b.indexOf(' Q '))))
  // Which cm positions have fills?
  const cmFillPositions: string[] = []
  for (const b of qBlocks) {
    const end = b.indexOf(' Q ')
    if (end < 0) continue
    const block = b.slice(0, end)
    if (!/\s(f|f\*)\s/.test(block)) continue
    const cmMatch = block.match(/([\d\.\-]+)\s+([\d\.\-]+)\s+cm/)
    if (cmMatch) cmFillPositions.push(`(${cmMatch[1]}, ${cmMatch[2]})`)
  }
  // q/Q balance
  const qCount = (text.match(/(^|\s)q(\s|$)/g) ?? []).length
  const bigQCount = (text.match(/(^|\s)Q(\s|$)/g) ?? []).length
  console.log(`\n═══ ${label} — ${stream.bytes.length} bytes`)
  console.log(`  fills: ${fillCount}  textBlocks: ${textBlocks}  filledBlocks: ${filledBlocks.length}`)
  console.log(`  q: ${qCount}  Q: ${bigQCount}  (balance: ${qCount - bigQCount})`)
  console.log(`  hasNavyHeader(40,532): ${hasNavyHeader}    hasDarkTop(0,696): ${hasDarkTop}`)

  // Extract the q...Q block that contains "40 532 cm" and print it
  const re = /q\s+[\s\S]*?Q/g
  const qBlocks2 = text.match(re) ?? []
  const navy = qBlocks2.find((b) => /40\s+532\s+cm/.test(b))
  if (navy) {
    console.log(`  navy block:\n    ${navy.slice(0, 400).replace(/\n/g, ' ¶ ')}`)
  }
}

import('node:process').then(() => {})

await dump('MASTER', master)
await dump('EDITED', path.resolve(process.cwd(), edited))
