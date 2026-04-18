#!/usr/bin/env tsx
// Phase 2 harness — exercise the paragraph editor against a specific
// target element in the stress-test PDF, produce the edited output,
// and emit a signed-off summary a human (or a later diff stage) can
// compare side-by-side with the master.
//
// Run:
//   npx tsx scripts/edit-test.mts <edit-descriptor.json>
// Or:
//   npx tsx scripts/edit-test.mts --builtin <name>     (uses scripts/edit-tests/<name>.json)
//   npx tsx scripts/edit-test.mts --list                (prints built-in tests)
//
// Output:
//   test-pdfs/stress-edited-<name>.pdf   — the edited working copy
//   Ready to open in the editor at http://localhost:1420/ via
//   window.__loadTestPdf('/test-pdfs/stress-edited-<name>.pdf')
//
// The harness imports the SAME applyParagraphEditsToBytes the browser
// uses (via tsx). We stub `window.api` so pdfFontResolution gracefully
// falls back to pd-lib Standard fonts in node. Position matching runs
// pdfjs-dist's legacy ESM build — node-compatible, no canvas needed
// for text extraction.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ── window.api stub ──────────────────────────────────────────────────
// pdfFontResolution calls window.api.font.listSystem() → returning []
// makes resolveSystemFont() always return null, so the save path falls
// through to the Standard-font pick. Same behavior as browser-mode
// testing.
// This must run BEFORE importing anything from src/services.
;(globalThis as Record<string, unknown>).window = {
  api: {
    font: {
      listSystem: async () => [],
      getBytes: async () => new Uint8Array(),
    },
  },
}

// pdfjs needs a worker URL — pdfjs-dist's legacy build resolves it
// via the default ESM loader, which on Windows rejects raw drive paths
// (D:\...). Pass a file:// URL instead.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
;(pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
  new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

import {
  clusterParagraphs,
  getParagraphTextColorsFromStream,
  type ParagraphBox,
} from '../src/services/pdfParagraphs.js'
import {
  applyParagraphEditsToBytes,
  type ParagraphEdit,
  type TextAlign,
} from '../src/services/pdfParagraphEdits.js'

// ── Paths ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO = path.resolve(__dirname, '..')
const TEST_PDFS = path.join(REPO, 'test-pdfs')
const MASTER = path.join(os.homedir(), 'Desktop', 'open-satchel-stress.pdf')
const BUILTINS_DIR = path.join(__dirname, 'edit-tests')

// ── Edit descriptor shape ────────────────────────────────────────────

interface TextEdit { type: 'text'; newText: string }
interface MoveEdit { type: 'move'; dx: number; dy: number }
interface AlignEdit { type: 'align'; align: TextAlign }
type EditOp = TextEdit | MoveEdit | AlignEdit

interface EditSpec {
  /** Short identifier, used in the output filename. */
  name: string
  /** Free-form description for logs. */
  description?: string
  /** 1-indexed page number. */
  page: number
  /** Exact match against a paragraph's originalText.trim(). If not
   *  unique on the page, `matchIndex` disambiguates. */
  matchText: string
  matchIndex?: number
  /** The mutation to apply. */
  edit: EditOp
}

// ── Built-in tests ───────────────────────────────────────────────────
// One JSON per test, so we can add them as we exercise different edges.
// Each test targets a SPECIFIC element and describes what should / should
// not change in the output.

function ensureBuiltins(): Record<string, EditSpec> {
  const builtins: Record<string, EditSpec> = {
    'rename-title': {
      name: 'rename-title',
      description: 'Rename the dark-header title on page 1',
      page: 1,
      matchText: 'Q4 2026 EARNINGS REPORT',
      edit: { type: 'text', newText: 'Q1 2027 EARNINGS REPORT' },
    },
    'rename-segment': {
      name: 'rename-segment',
      description:
        'Rename "Segment" column header (white text on navy bar). ' +
        'Regression test for the content-stream color bug — the new text ' +
        'must stay white because the source PDF stored white, not because ' +
        'the bg looks dark.',
      page: 1,
      matchText: 'Segment',
      edit: { type: 'text', newText: 'Division' },
    },
    'rename-guidance': {
      name: 'rename-guidance',
      description:
        'Rename the "Guidance" callout heading (warm gold-ish text on ' +
        'beige bg). Exercises non-black, non-white text color.',
      page: 1,
      matchText: 'Guidance',
      edit: { type: 'text', newText: 'Outlook' },
    },
    'move-invoice': {
      name: 'move-invoice',
      description:
        'Drag the dark-header title down into the body area. Exercises ' +
        'the position-delta save path + ghost-mask preview.',
      page: 1,
      matchText: 'Q4 2026 EARNINGS REPORT',
      edit: { type: 'move', dx: 40, dy: 120 },
    },
    'align-thanks': {
      name: 'align-thanks',
      description: 'Center-align a body paragraph.',
      page: 2,
      matchText: 'Design is not what it looks like. Design is how it works.',
      edit: { type: 'align', align: 'center' },
    },
    'rename-chinese': {
      name: 'rename-chinese',
      description:
        'Replace a Chinese paragraph with different Chinese text. Tests ' +
        'CJK re-embedding through the save path — we expect this to show ' +
        'the same glyph-gap failure until we replace pd-lib\'s subsetter ' +
        '(see ROADMAP.md M3.5 note).',
      page: 3,
      matchText: '排版设计是无国界的艺术。文字的形状和空间的节奏共同塑造了阅读的体验。一份精心设计的文档能够跨越语言的障碍，以其视觉语言与读者进行交流。这是一段测试文字，用于验证简体中文字体在编辑器中的渲染和编辑行为。',
      edit: { type: 'text', newText: '你好世界。这是新的中文文字。' },
    },
  }
  if (!fs.existsSync(BUILTINS_DIR)) fs.mkdirSync(BUILTINS_DIR, { recursive: true })
  for (const [name, spec] of Object.entries(builtins)) {
    const p = path.join(BUILTINS_DIR, `${name}.json`)
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, JSON.stringify(spec, null, 2))
    }
  }
  return builtins
}

// ── Helpers ──────────────────────────────────────────────────────────

function loadSpec(specArg: string, useBuiltin: boolean): EditSpec {
  if (useBuiltin) {
    const p = path.join(BUILTINS_DIR, `${specArg}.json`)
    if (!fs.existsSync(p)) {
      console.error(`No built-in test named '${specArg}'. Available:`)
      for (const f of fs.readdirSync(BUILTINS_DIR)) {
        if (f.endsWith('.json')) console.error('  ' + f.replace(/\.json$/, ''))
      }
      process.exit(1)
    }
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as EditSpec
  }
  if (!fs.existsSync(specArg)) {
    console.error(`Spec file not found: ${specArg}`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(specArg, 'utf-8')) as EditSpec
}

async function findTargetParagraph(
  pdfBytes: Uint8Array,
  spec: EditSpec,
): Promise<{ paragraph: ParagraphBox; pageIndex: number; pageHeight: number }> {
  const pageIndex = spec.page - 1
  const doc = await pdfjsLib.getDocument({
    data: pdfBytes.slice(), // pdfjs mutates the buffer
    disableFontFace: true,
    useSystemFonts: false,
  }).promise
  const res = await clusterParagraphs(doc, pageIndex)

  // Mirror the browser's color pipeline: extract text colors from the
  // content stream, attach to each paragraph so save-time uses the
  // author-set color (not the default black). Without this the
  // harness draws black over white-on-dark headers.
  const colorMap = await getParagraphTextColorsFromStream(
    pdfBytes,
    pageIndex,
    res.paragraphs,
    res.pageHeight,
  )
  const paragraphsWithColors = res.paragraphs.map((p) => {
    const c = colorMap.get(p.id)
    if (!c) return p
    const r = parseInt(c.slice(1, 3), 16) / 255
    const g = parseInt(c.slice(3, 5), 16) / 255
    const b = parseInt(c.slice(5, 7), 16) / 255
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const onDarkBackground = lum > 0.5
    // The browser's sampleParagraphBackgrounds() samples the rendered
    // canvas for the bg color (used by the save-time invisible mask
    // rect). We can't sample a canvas in node, so derive a reasonable
    // guess from the text-color luminance — light text implies a dark
    // bg, dark text implies a light one. Wrong on medium/colored bars
    // (e.g. the blue Description row), which will need either a node
    // rasterizer or live-browser path for precise verification. Good
    // enough to exercise the save pipeline for now.
    const backgroundColor = onDarkBackground ? '#101518' : '#ffffff'
    return { ...p, color: c, onDarkBackground, backgroundColor }
  })

  const matches = paragraphsWithColors.filter((p) => p.originalText.trim() === spec.matchText)
  if (matches.length === 0) {
    console.error(`\n[fail] No paragraph with text "${spec.matchText}" on page ${spec.page}.`)
    console.error('\nAvailable paragraphs on that page:')
    for (const p of paragraphsWithColors) {
      const preview = p.originalText.trim().slice(0, 60)
      console.error(`  • ${preview}${p.originalText.length > 60 ? '…' : ''}`)
    }
    process.exit(2)
  }
  const idx = spec.matchIndex ?? 0
  if (idx >= matches.length) {
    console.error(`\n[fail] matchIndex ${idx} out of range (${matches.length} matches).`)
    process.exit(2)
  }
  return { paragraph: matches[idx], pageIndex, pageHeight: res.pageHeight }
}

function buildEdit(target: ParagraphBox, op: EditOp): ParagraphEdit {
  const base: ParagraphEdit = {
    paragraphId: target.id,
    bbox: target.bbox,
    originalText: target.originalText,
    newText: target.originalText,
    fontSize: target.fontSize,
    color: target.color,
    backgroundColor: target.backgroundColor,
    bold: target.bold,
    italic: target.italic,
    fontFamily: target.fontFamily,
    itemIndices: [...target.itemIndices],
    itemOriginalTexts: target.lines.flatMap((l) => l.text.split(/(?=\s)/)),
  }
  if (op.type === 'text') return { ...base, newText: op.newText }
  if (op.type === 'align') return { ...base, align: op.align }
  if (op.type === 'move') return { ...base, positionDelta: { dx: op.dx, dy: op.dy } }
  throw new Error('unknown edit op')
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  // Write built-in test specs to disk (first run / new specs added).
  const builtins = ensureBuiltins()

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage:')
    console.log('  npx tsx scripts/edit-test.mts --list')
    console.log('  npx tsx scripts/edit-test.mts --builtin <name>')
    console.log('  npx tsx scripts/edit-test.mts <path-to-spec.json>')
    console.log('')
    console.log('Built-in tests:')
    for (const name of Object.keys(builtins)) {
      console.log(`  ${name.padEnd(22)} ${builtins[name].description ?? ''}`)
    }
    process.exit(0)
  }

  if (args[0] === '--list') {
    for (const name of Object.keys(builtins)) {
      console.log(`${name.padEnd(22)} ${builtins[name].description ?? ''}`)
    }
    process.exit(0)
  }

  let spec: EditSpec
  if (args[0] === '--builtin') {
    if (!args[1]) { console.error('Missing built-in name'); process.exit(1) }
    spec = loadSpec(args[1], true)
  } else {
    spec = loadSpec(args[0], false)
  }

  if (!fs.existsSync(MASTER)) {
    console.error(`Master PDF not found at ${MASTER}`)
    console.error('Run `node scripts/gen-stress-pdf.mjs` first.')
    process.exit(1)
  }

  console.log(`═══ ${spec.name} ═══`)
  if (spec.description) console.log(spec.description)
  console.log()

  // 1. Copy master → working
  const workingPath = path.join(TEST_PDFS, `stress-edited-${spec.name}.pdf`)
  if (!fs.existsSync(TEST_PDFS)) fs.mkdirSync(TEST_PDFS, { recursive: true })
  const masterBytes = new Uint8Array(fs.readFileSync(MASTER))
  console.log(`[1/4] Loaded master (${Math.round(masterBytes.length / 1024)} KB)`)

  // 2. Find target paragraph
  const { paragraph: target, pageIndex } = await findTargetParagraph(masterBytes, spec)
  console.log(`[2/4] Found target on page ${spec.page}`)
  console.log(`        paragraph id: ${target.id}`)
  console.log(`        bbox: x=${target.bbox.x.toFixed(1)} y=${target.bbox.y.toFixed(1)} w=${target.bbox.width.toFixed(1)} h=${target.bbox.height.toFixed(1)}`)
  console.log(`        color: ${target.color}    bg: ${target.backgroundColor}`)
  console.log(`        font: ${target.fontFamily}${target.bold ? ' Bold' : ''}${target.italic ? ' Italic' : ''} ${target.fontSize.toFixed(1)}pt`)

  // 3. Apply
  const edit = buildEdit(target, spec.edit)
  console.log(`[3/4] Applying edit: ${JSON.stringify(spec.edit)}`)
  const outBytes = await applyParagraphEditsToBytes(masterBytes, pageIndex, [edit])

  // 4. Write working copy
  fs.writeFileSync(workingPath, outBytes)
  console.log(`[4/4] Wrote ${Math.round(outBytes.length / 1024)} KB → ${workingPath}`)
  console.log()
  console.log(`Next step — compare in the editor:`)
  const rel = path.relative(REPO, workingPath).replaceAll('\\', '/')
  console.log(`  http://localhost:1420/  →  window.__loadTestPdf('/${rel}')`)
  console.log(`  or load the master first ('/test-pdfs/stress.pdf') for side-by-side.`)
  console.log(`  Output URL: ${pathToFileURL(workingPath).href}`)
}

main().catch((err) => {
  console.error('\n[exception]', err)
  process.exit(1)
})
