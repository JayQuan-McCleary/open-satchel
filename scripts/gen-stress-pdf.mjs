// Generator for the "Open Satchel stress-test" PDF.
//
// Run:  node scripts/gen-stress-pdf.mjs
// Output: %USERPROFILE%/Desktop/open-satchel-stress.pdf (Windows)
//         $HOME/Desktop/open-satchel-stress.pdf         (macOS/Linux)
//
// This script exists to give the paragraph editor a genuinely adversarial
// test fixture. Everything in here is intentionally structured to stress
// the edges of what v1 editing assumes: tight colored bars around white
// text, multiple fonts on the same page, CJK + RTL scripts, overlapping
// shapes, rotations, transparency, form-like grids, multi-column flow,
// and images with borders. If the editor survives this document, it'll
// survive the invoices real people throw at it.
//
// Fonts and images are cached under scripts/fonts/ and scripts/images/
// (gitignored). First run downloads fonts from the google/fonts GitHub
// mirror and generates procedural test images; subsequent runs reuse
// the cache.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FONTS_DIR = path.join(__dirname, 'fonts')
const IMAGES_DIR = path.join(__dirname, 'images')
const OUT_PATH = path.join(os.homedir(), 'Desktop', 'open-satchel-stress.pdf')

// ── Font manifest ──────────────────────────────────────────────────
// We pull free-licensed fonts from the google/fonts GitHub mirror.
// Stable URLs, no User-Agent tricks needed. CJK and Arabic faces are
// kept minimal; pd-lib's embedFont subsets them so final PDF size
// stays reasonable even with full-glyph source TTFs on disk.
const FONTS = {
  notoSansRegular: {
    file: 'NotoSans-Regular.ttf',
    urls: [
      'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf',
    ],
  },
  notoSansBold: {
    file: 'NotoSans-Bold.ttf',
    urls: [
      'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf',
    ],
  },
  notoSansItalic: {
    file: 'NotoSans-Italic.ttf',
    urls: [
      'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Italic.ttf',
    ],
  },
  notoSerif: {
    file: 'NotoSerif-Regular.ttf',
    urls: [
      'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSerif/hinted/ttf/NotoSerif-Regular.ttf',
    ],
  },
  robotoMono: {
    file: 'RobotoMono-Regular.ttf',
    urls: [
      'https://raw.githubusercontent.com/googlefonts/RobotoMono/main/fonts/ttf/RobotoMono-Regular.ttf',
    ],
  },
  notoSansSC: {
    file: 'NotoSansSC.ttf',
    urls: [
      'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
    ],
  },
  amiri: {
    file: 'Amiri-Regular.ttf',
    urls: [
      'https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf',
    ],
  },
}

// ── Image manifest ─────────────────────────────────────────────────
// Images are generated procedurally on first run. No binary files in
// the repo. We encode tiny synthetic PNGs (solid + gradient + pattern)
// that exercise the image-embedding paths for the editor.
const IMAGES = {
  chart: { file: 'chart.png', kind: 'chart', width: 320, height: 200 },
  logo: { file: 'logo.png', kind: 'logo', width: 160, height: 160 },
  photo: { file: 'photo.png', kind: 'photo', width: 240, height: 180 },
}

// ── Font download ──────────────────────────────────────────────────

async function downloadFont(urls, outPath) {
  let lastErr
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'open-satchel-stress-gen/1.0' },
      })
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(outPath, buf)
      return buf
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error('no URLs succeeded')
}

async function ensureFont(key) {
  const spec = FONTS[key]
  const filePath = path.join(FONTS_DIR, spec.file)
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024) {
    return fs.readFileSync(filePath)
  }
  process.stdout.write(`  fetching ${spec.file} ...`)
  try {
    const bytes = await downloadFont(spec.urls, filePath)
    process.stdout.write(` ${Math.round(bytes.length / 1024)} KB\n`)
    return bytes
  } catch (err) {
    process.stdout.write(` FAILED\n`)
    throw new Error(
      `Could not fetch ${spec.file}: ${err.message}\n` +
      `  Tried URLs:\n    ${spec.urls.join('\n    ')}\n` +
      `  Place the file manually in ${FONTS_DIR}/${spec.file} and re-run.`,
    )
  }
}

// ── Procedural PNG generator ───────────────────────────────────────
// We write the full PNG format by hand (signature + IHDR + IDAT + IEND)
// so we don't need the `canvas` or `sharp` native deps. pako is already
// in the project deps for PDF flate handling; we reuse node's built-in
// zlib here.

function crc32(buf) {
  // Standard CRC-32 for PNG chunks. Table pre-computed lazily.
  if (!crc32.table) {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    crc32.table = t
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const crc = crc32(Buffer.concat([typeBytes, data]))
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc)
  return Buffer.concat([len, typeBytes, data, crcBuf])
}

/** Encode an RGBA Uint8Array (width*height*4 bytes) as a PNG. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8     // bit depth
  ihdr[9] = 6     // color type: RGBA
  ihdr[10] = 0    // compression
  ihdr[11] = 0    // filter
  ihdr[12] = 0    // interlace
  // Row filter byte (0 = None) prepended to each row of RGBA.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x]
    }
  }
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function hsvToRgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function drawChart(width, height) {
  // Bar chart on a white bg with an accent border.
  const rgba = new Uint8Array(width * height * 4)
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const o = (y * width + x) * 4
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a
  }
  // White background
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, 255, 255, 255)
  // Border
  for (let x = 0; x < width; x++) { set(x, 0, 30, 58, 138); set(x, height - 1, 30, 58, 138) }
  for (let y = 0; y < height; y++) { set(0, y, 30, 58, 138); set(width - 1, y, 30, 58, 138) }
  // Bars
  const bars = [0.4, 0.65, 0.55, 0.85, 0.72, 0.95, 0.6]
  const barW = Math.floor((width - 40) / bars.length)
  const base = height - 20
  for (let i = 0; i < bars.length; i++) {
    const h = Math.round((base - 20) * bars[i])
    const x0 = 20 + i * barW
    const [r, g, b] = hsvToRgb((i * 50) % 360, 0.7, 0.85)
    for (let y = base - h; y < base; y++) {
      for (let x = x0 + 4; x < x0 + barW - 4; x++) set(x, y, r, g, b)
    }
  }
  // Baseline
  for (let x = 10; x < width - 10; x++) set(x, base, 100, 100, 100)
  return encodePng(width, height, rgba)
}

function drawLogo(width, height) {
  // Concentric circles with transparent bg + a solid center.
  const rgba = new Uint8Array(width * height * 4) // zero = transparent
  const cx = width / 2, cy = height / 2
  const rMax = Math.min(width, height) / 2 - 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx, dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > rMax) continue
      // Rings: hue rotates with radius
      const ring = Math.floor((d / rMax) * 5)
      const [r, g, b] = hsvToRgb((ring * 60 + 200) % 360, 0.8, 0.9)
      const o = (y * width + x) * 4
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b
      rgba[o + 3] = d < rMax - 8 ? 255 : Math.round((rMax - d) / 8 * 255)
    }
  }
  return encodePng(width, height, rgba)
}

function drawPhoto(width, height) {
  // Faux sunset gradient with horizon + a "sun" disc.
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const t = y / height
    let r, g, b
    if (t < 0.6) {
      // Sky: purple → orange gradient
      const tt = t / 0.6
      r = Math.round(50 + tt * 230)
      g = Math.round(40 + tt * 120)
      b = Math.round(100 + tt * 80 - tt * tt * 120)
    } else {
      // Water: dark blue with ripples
      const tt = (t - 0.6) / 0.4
      r = Math.round(30 + tt * 20)
      g = Math.round(50 + tt * 30 + Math.sin(tt * 40) * 10)
      b = Math.round(90 + tt * 40)
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255
    }
  }
  // Sun disc near upper-right third
  const sx = Math.round(width * 0.7), sy = Math.round(height * 0.35), sr = Math.min(width, height) * 0.12
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.sqrt((x - sx) ** 2 + (y - sy) ** 2)
      if (d > sr) continue
      const o = (y * width + x) * 4
      const fall = d / sr
      rgba[o] = Math.round(255 - fall * 40)
      rgba[o + 1] = Math.round(240 - fall * 100)
      rgba[o + 2] = Math.round(200 - fall * 150)
    }
  }
  return encodePng(width, height, rgba)
}

function ensureImage(key) {
  const spec = IMAGES[key]
  const filePath = path.join(IMAGES_DIR, spec.file)
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 64) {
    return fs.readFileSync(filePath)
  }
  process.stdout.write(`  generating ${spec.file} (${spec.kind}) ...`)
  let bytes
  if (spec.kind === 'chart') bytes = drawChart(spec.width, spec.height)
  else if (spec.kind === 'logo') bytes = drawLogo(spec.width, spec.height)
  else if (spec.kind === 'photo') bytes = drawPhoto(spec.width, spec.height)
  else throw new Error(`unknown image kind: ${spec.kind}`)
  fs.writeFileSync(filePath, bytes)
  process.stdout.write(` ${Math.round(bytes.length / 1024)} KB\n`)
  return bytes
}

// ── Drawing helpers ────────────────────────────────────────────────

const C = {
  navy: rgb(0.118, 0.227, 0.541),
  deepBlue: rgb(0.067, 0.149, 0.353),
  accent: rgb(0.290, 0.565, 0.851),
  red: rgb(0.878, 0.192, 0.192),
  green: rgb(0.133, 0.604, 0.353),
  gold: rgb(0.961, 0.733, 0.157),
  ink: rgb(0.118, 0.133, 0.145),
  gray: rgb(0.4, 0.4, 0.4),
  lightGray: rgb(0.92, 0.92, 0.94),
  white: rgb(1, 1, 1),
  purple: rgb(0.431, 0.239, 0.651),
  teal: rgb(0.169, 0.576, 0.569),
  coral: rgb(0.949, 0.427, 0.416),
  mask: rgb(0.970, 0.975, 0.985),
}

function textWidth(text, font, size) {
  try { return font.widthOfTextAtSize(text, size) }
  catch { return text.length * size * 0.5 }
}

function drawHRule(page, x, y, w, color = C.gray, thickness = 0.5) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color })
}

function drawFilledRect(page, x, y, w, h, color, opacity = 1) {
  page.drawRectangle({ x, y, width: w, height: h, color, opacity })
}

function drawBorderedRect(page, x, y, w, h, fill, border, borderWidth = 1) {
  page.drawRectangle({
    x, y, width: w, height: h,
    color: fill,
    borderColor: border,
    borderWidth,
  })
}

// ── Page 1: Q4 Earnings Report ─────────────────────────────────────
// Stress areas: dark bar with white text, tight colored KPI boxes,
// alternating-row table with right-aligned numbers, embedded chart
// image with a 2pt border, rotated CONFIDENTIAL stamp, italic footer.

function drawPage1(page, fonts, images) {
  const { width: W, height: H } = page.getSize()

  // Dark header band
  drawFilledRect(page, 0, H - 96, W, 96, C.deepBlue)
  page.drawText('Q4 2026 EARNINGS REPORT', {
    x: 40, y: H - 60, size: 26, font: fonts.notoSansBold, color: C.white,
  })
  page.drawText('Prepared for the Board of Directors · Confidential', {
    x: 40, y: H - 82, size: 10, font: fonts.notoSansItalic, color: rgb(0.70, 0.82, 0.98),
  })

  // Rotated "CONFIDENTIAL" stamp over the header right edge
  page.drawText('CONFIDENTIAL', {
    x: W - 180, y: H - 72, size: 16, font: fonts.notoSansBold,
    color: C.red, rotate: degrees(15), opacity: 0.55,
  })

  // Left column — executive summary. Kept intentionally short so the
  // text doesn't overflow into the table row below it. Earlier versions
  // had 3 sentences that wrapped to 8 lines, and the last word collided
  // with the "Segment" column header — clustering then merged them and
  // "Segment" became untargetable in the editor. Stress should break
  // the SAVE pipeline, not sabotage the tests.
  page.drawText('EXECUTIVE SUMMARY', {
    x: 40, y: H - 130, size: 10, font: fonts.notoSansBold, color: C.accent,
  })
  drawHRule(page, 40, H - 138, 150, C.accent, 1)
  const summary =
    'Revenue grew 18% YoY on EMEA expansion. Margin +230 bps. ' +
    'Free cash flow reached $1.2B.'
  wrapAndDraw(page, summary, 40, H - 155, 170, 10, fonts.notoSansRegular, C.ink, 13)

  // Right column — KPIs
  const kpis = [
    { label: 'REVENUE',       value: '$4.8B',  delta: '+18%', up: true },
    { label: 'NET INCOME',    value: '$920M',  delta: '+24%', up: true },
    { label: 'FREE CASH',     value: '$1.2B',  delta: '+9%',  up: true },
    { label: 'OP. MARGIN',    value: '23.4%',  delta: '-40bps', up: false },
  ]
  const kpiX = 240, kpiY = H - 130, kpiW = 80, kpiH = 68, kpiGap = 10
  kpis.forEach((k, i) => {
    const x = kpiX + i * (kpiW + kpiGap)
    // Subtle card background — stress for mask-color detection
    drawBorderedRect(page, x, kpiY - kpiH, kpiW, kpiH, rgb(0.965, 0.975, 0.99), rgb(0.85, 0.88, 0.94), 0.7)
    page.drawText(k.label, { x: x + 8, y: kpiY - 16, size: 8, font: fonts.notoSansBold, color: C.gray })
    page.drawText(k.value, { x: x + 8, y: kpiY - 38, size: 16, font: fonts.notoSansBold, color: C.ink })
    page.drawText(k.delta, {
      x: x + 8, y: kpiY - 56, size: 9, font: fonts.notoSansRegular,
      color: k.up ? C.green : C.red,
    })
  })

  // Data table
  const tX = 40, tY = H - 260, tW = W - 80, tRowH = 18
  const cols = [
    { key: 'Segment',    w: 150, align: 'left' },
    { key: 'Revenue',    w: 90,  align: 'right' },
    { key: 'Δ YoY',      w: 70,  align: 'right' },
    { key: 'Op. Inc.',   w: 90,  align: 'right' },
    { key: 'Margin',     w: 70,  align: 'right' },
  ]
  const rows = [
    ['Cloud Services',       '$2,140M', '+28%', '$580M', '27.1%'],
    ['Enterprise Software',  '$1,510M', '+12%', '$390M', '25.8%'],
    ['Consumer',             '$620M',   '+3%',  '$85M',  '13.7%'],
    ['Advertising',          '$430M',   '+22%', '$120M', '27.9%'],
    ['Hardware',             '$100M',   '-8%',  '-$12M', '—'],
  ]
  // Header row
  let cx = tX
  drawFilledRect(page, tX, tY, tW, tRowH, C.navy)
  for (const c of cols) {
    const label = c.key
    const lw = textWidth(label, fonts.notoSansBold, 9)
    const x = c.align === 'right' ? cx + c.w - lw - 8 : cx + 8
    page.drawText(label, { x, y: tY + 5, size: 9, font: fonts.notoSansBold, color: C.white })
    cx += c.w
  }
  // Data rows — alternating bg
  rows.forEach((row, r) => {
    const rowY = tY - (r + 1) * tRowH
    if (r % 2 === 1) drawFilledRect(page, tX, rowY, tW, tRowH, C.lightGray)
    cx = tX
    row.forEach((cell, i) => {
      const col = cols[i]
      const font = i === 0 ? fonts.notoSansRegular : fonts.robotoMono
      const lw = textWidth(cell, font, 9)
      const x = col.align === 'right' ? cx + col.w - lw - 8 : cx + 8
      const color = cell.startsWith('-') ? C.red : (cell.startsWith('+') ? C.green : C.ink)
      page.drawText(cell, { x, y: rowY + 5, size: 9, font, color })
      cx += col.w
    })
  })

  // Chart image with thick border — drawn into a bordered frame
  const chartX = tX, chartY = tY - rows.length * tRowH - 180, chartW = 220, chartH = 130
  drawBorderedRect(page, chartX - 4, chartY - 4, chartW + 8, chartH + 8, C.white, C.ink, 2)
  page.drawImage(images.chart, { x: chartX, y: chartY, width: chartW, height: chartH })
  page.drawText('Fig. 1 — Quarterly revenue by segment', {
    x: chartX, y: chartY - 14, size: 8, font: fonts.notoSansItalic, color: C.gray,
  })

  // Right-side callout block
  const calloutX = 300, calloutY = chartY + chartH, calloutW = W - 40 - calloutX, calloutH = chartH + 8
  drawFilledRect(page, calloutX, calloutY - calloutH, calloutW, calloutH, rgb(0.98, 0.95, 0.90))
  drawHRule(page, calloutX, calloutY, calloutW, C.gold, 2)
  page.drawText('Guidance', {
    x: calloutX + 12, y: calloutY - 20, size: 11, font: fonts.notoSansBold, color: rgb(0.6, 0.4, 0.05),
  })
  wrapAndDraw(page,
    'For FY2027 we expect revenue in the range of $20B-$21B, with operating margins expanding modestly. ' +
    'Capital allocation priorities remain organic growth, R&D, and continued returns to shareholders.',
    calloutX + 12, calloutY - 36, calloutW - 24, 9, fonts.notoSansRegular, C.ink, 12,
  )

  // Footer
  drawHRule(page, 40, 56, W - 80, rgb(0.85, 0.85, 0.85), 0.5)
  page.drawText('© 2026 Acme Industries Inc. · Page 1 of 5', {
    x: 40, y: 42, size: 7, font: fonts.notoSansItalic, color: C.gray,
  })
  page.drawText('Restricted — do not distribute', {
    x: W - 170, y: 42, size: 7, font: fonts.notoSansItalic, color: C.red,
  })

  // Rotated DRAFT watermark at very low opacity
  page.drawText('DRAFT', {
    x: W / 2 - 130, y: 180, size: 96, font: fonts.notoSansBold,
    color: rgb(0.88, 0.88, 0.92), rotate: degrees(45), opacity: 0.25,
  })
}

// ── Page 2: 3-column magazine article ──────────────────────────────
// Stress areas: serif body text at column widths, drop cap of a different
// color, pull quote in italic with decorative rules, image embedded with
// a caption, text wrapping conceptually around the image.

function drawPage2(page, fonts, images) {
  const { width: W, height: H } = page.getSize()

  // Title block
  page.drawText('The Science of Typography', {
    x: 40, y: H - 72, size: 34, font: fonts.notoSerif, color: C.ink,
  })
  page.drawText('Why the shape of a letter changes the meaning of a word', {
    x: 40, y: H - 100, size: 12, font: fonts.notoSansItalic, color: C.accent,
  })
  page.drawText('by Jane Doe   ·   April 2026   ·   7 min read', {
    x: 40, y: H - 120, size: 9, font: fonts.notoSansRegular, color: C.gray,
  })
  drawHRule(page, 40, H - 130, W - 80, C.ink, 1)

  // 3-column body
  const colGap = 18
  const colCount = 3
  const bodyX = 40, bodyY = H - 150
  const bodyW = W - 80
  const colW = (bodyW - colGap * (colCount - 1)) / colCount
  const bodyH = bodyY - 160

  const bodyText = [
    'Typography is the invisible craft that shapes how we read. ' +
    'Every letterform carries weight beyond its meaning: the curve ' +
    'of a lowercase "a", the crossbar of a capital "T", the counter ' +
    'inside an "o" — each decision ripples through the reading ' +
    'experience in ways most people never consciously notice.',

    'When Eric Gill drew Gill Sans in 1928 he was trying to rescue ' +
    'signage in the British Rail network from what he called the ' +
    '"confusion of unskilled hands". He succeeded beautifully, and ' +
    'his letterforms remained the visual language of British public ' +
    'life for most of the twentieth century.',

    'Today we have more typefaces than any previous generation could ' +
    'have imagined. There are fonts optimized for in-car dashboards, ' +
    'fonts tuned for dyslexic readers, fonts engineered to survive ' +
    'the low resolution of early Kindle screens, and fonts designed ' +
    'with no purpose other than to look beautiful on a poster.',

    'Yet our eyes remain the same. We still parse words the way our ' +
    'ancestors parsed cave paintings — by spotting the outer shapes ' +
    'first, then the details. A good typographer is an engineer of ' +
    'the ambient; they set up the conditions under which meaning ' +
    'can be understood almost without effort.',

    'This is why the choice between a humanist sans-serif and a ' +
    'geometric one changes a document even when the words stay the ' +
    'same. It is why news outlets have moved to custom typefaces in ' +
    'the past decade. And it is why the quiet revolution of variable ' +
    'fonts matters more than the hype around them suggests.',
  ].join('  ')

  // Simple column packing: word-wrap per-column, break to next when full.
  const fontBody = fonts.notoSerif
  const sizeBody = 10
  const lineH = 14
  const words = bodyText.split(/\s+/)
  let wIdx = 0
  for (let c = 0; c < colCount; c++) {
    const cx = bodyX + c * (colW + colGap)
    let y = bodyY
    // First column gets a drop cap — move initial text in by the cap width
    const dropCapOffset = c === 0 ? 36 : 0
    if (c === 0) {
      page.drawText('T', {
        x: cx, y: y - 36, size: 52, font: fonts.notoSerif, color: C.accent,
      })
    }
    let firstLine = true
    while (wIdx < words.length && y > bodyY - bodyH) {
      // Build one line
      let line = ''
      const maxLineW = firstLine && c === 0 ? colW - dropCapOffset : colW
      while (wIdx < words.length) {
        const candidate = line ? line + ' ' + words[wIdx] : words[wIdx]
        if (textWidth(candidate, fontBody, sizeBody) > maxLineW) break
        line = candidate
        wIdx++
      }
      if (!line) { wIdx++; continue }
      const lineX = firstLine && c === 0 ? cx + dropCapOffset : cx
      page.drawText(line, { x: lineX, y, size: sizeBody, font: fontBody, color: C.ink })
      y -= lineH
      firstLine = false
    }
  }

  // Image with border, overlapping columns 2-3 near the bottom of the body
  const imgX = bodyX + colW + colGap + 10
  const imgY = bodyY - bodyH + 20
  const imgW = colW + colGap + colW - 20
  const imgH = 90
  drawBorderedRect(page, imgX - 2, imgY - 2, imgW + 4, imgH + 4, C.white, C.ink, 1.5)
  page.drawImage(images.photo, { x: imgX, y: imgY, width: imgW, height: imgH })
  page.drawText('Sunset over the Aegean · photograph by the author', {
    x: imgX, y: imgY - 12, size: 7, font: fonts.notoSansItalic, color: C.gray,
  })

  // Pull quote spanning center, decorative rules
  const quoteY = 280
  drawHRule(page, 120, quoteY + 26, W - 240, C.accent, 1.5)
  drawHRule(page, 120, quoteY - 14, W - 240, C.accent, 1.5)
  page.drawText('"Design is not what it looks like. Design is how it works."', {
    x: 140, y: quoteY, size: 14, font: fonts.notoSansItalic, color: C.deepBlue,
  })
  page.drawText('— Steve Jobs', {
    x: 140, y: quoteY - 34, size: 9, font: fonts.notoSansRegular, color: C.gray,
  })

  // Footer
  drawHRule(page, 40, 56, W - 80, rgb(0.85, 0.85, 0.85), 0.5)
  page.drawText('© 2026 Typography Review · Page 2 of 5', {
    x: 40, y: 42, size: 7, font: fonts.notoSansItalic, color: C.gray,
  })
}

// ── Page 3: Multilingual ───────────────────────────────────────────
// Stress areas: CJK glyphs in NotoSansSC, RTL Arabic in Amiri, mixed
// scripts on one line, non-ASCII characters in paragraph bodies.

function drawPage3(page, fonts) {
  const { width: W, height: H } = page.getSize()

  // Title bar
  drawFilledRect(page, 0, H - 80, W, 80, C.purple)
  page.drawText('INTERNATIONAL', {
    x: 40, y: H - 50, size: 26, font: fonts.notoSansBold, color: C.white,
  })
  // Mixed-script subtitle — tests font fallback behavior when a single
  // text-show op only has one font but mixed glyphs.
  page.drawText('Hello', {
    x: 40, y: H - 72, size: 12, font: fonts.notoSansRegular, color: C.white,
  })
  page.drawText(' · ', { x: 82, y: H - 72, size: 12, font: fonts.notoSansRegular, color: C.white })
  page.drawText('你好', {
    x: 95, y: H - 72, size: 12, font: fonts.notoSansSC, color: C.white,
  })
  page.drawText(' · ', { x: 123, y: H - 72, size: 12, font: fonts.notoSansRegular, color: C.white })
  page.drawText('مرحبا', {
    x: 136, y: H - 72, size: 12, font: fonts.amiri, color: C.white,
  })

  let y = H - 110

  // English
  page.drawText('EN', { x: 40, y, size: 9, font: fonts.notoSansBold, color: C.accent })
  wrapAndDraw(page,
    'Typography crosses borders but fonts do not always follow. ' +
    'A well-designed document speaks the reader\'s visual language by ' +
    'using letterforms that already feel native to their eye.',
    70, y, W - 110, 11, fonts.notoSansRegular, C.ink, 14,
  )
  y -= 60

  // Chinese
  page.drawText('ZH', { x: 40, y, size: 9, font: fonts.notoSansBold, color: C.accent })
  wrapAndDraw(page,
    '排版设计是无国界的艺术。文字的形状和空间的节奏共同塑造了阅读的体验。' +
    '一份精心设计的文档能够跨越语言的障碍，以其视觉语言与读者进行交流。' +
    '这是一段测试文字，用于验证简体中文字体在编辑器中的渲染和编辑行为。',
    70, y, W - 110, 11, fonts.notoSansSC, C.ink, 16,
  )
  y -= 80

  // Arabic (RTL)
  page.drawText('AR', { x: 40, y, size: 9, font: fonts.notoSansBold, color: C.accent })
  // Draw RTL: we right-align by measuring the line and placing x at
  // (right edge) - width. pd-lib + fontkit handles the Arabic shaping
  // (contextual forms) because fontkit supports OpenType layout.
  const arabicLines = [
    'هذه فقرة اختبار مكتوبة باللغة العربية لاختبار دعم النصوص من اليمين',
    'إلى اليسار في محرر المستندات. يجب أن تظهر الحروف متصلة بشكل صحيح.',
    'ويجب أن يكون النص محاذياً إلى اليمين كما هو متوقع في الكتابة العربية.',
  ]
  const ar = fonts.amiri
  const arSize = 13
  const rightEdge = W - 40
  arabicLines.forEach((line, i) => {
    const lw = textWidth(line, ar, arSize)
    page.drawText(line, {
      x: rightEdge - lw, y: y - i * 20, size: arSize, font: ar, color: C.ink,
    })
  })
  y -= arabicLines.length * 20 + 20

  // Mixed inline: numerals embedded with scripts
  page.drawText('MX', { x: 40, y, size: 9, font: fonts.notoSansBold, color: C.accent })
  // "The year 2026 (二零二六年 / ٢٠٢٦)" — split so each span uses the right font
  let mx = 70
  const spans = [
    { text: 'The year 2026 (', font: fonts.notoSansRegular },
    { text: '二零二六年', font: fonts.notoSansSC },
    { text: ' / ', font: fonts.notoSansRegular },
    { text: '٢٠٢٦', font: fonts.amiri },
    { text: ')', font: fonts.notoSansRegular },
  ]
  for (const s of spans) {
    page.drawText(s.text, { x: mx, y, size: 12, font: s.font, color: C.ink })
    mx += textWidth(s.text, s.font, 12)
  }
  y -= 30

  // Bilingual quote box with bg color
  const boxH = 70
  drawFilledRect(page, 40, y - boxH, W - 80, boxH, rgb(0.97, 0.94, 0.99))
  drawHRule(page, 40, y, W - 80, C.purple, 2)
  page.drawText('"A word is not the same word in two languages."', {
    x: 60, y: y - 22, size: 13, font: fonts.notoSansItalic, color: C.purple,
  })
  page.drawText('"一个词在两种语言中不是同一个词。"', {
    x: 60, y: y - 46, size: 13, font: fonts.notoSansSC, color: C.purple,
  })

  // Footer
  drawHRule(page, 40, 56, W - 80, rgb(0.85, 0.85, 0.85), 0.5)
  page.drawText('© 2026 Acme Industries Inc. · Page 3 of 5', {
    x: 40, y: 42, size: 7, font: fonts.notoSansItalic, color: C.gray,
  })
}

// ── Page 4: Dense registration form ────────────────────────────────
// Stress areas: lots of tight label/value pairs, checkboxes drawn as
// rects with check glyphs, section dividers, signature line.

function drawPage4(page, fonts) {
  const { width: W, height: H } = page.getSize()

  // Heavy title bar
  drawFilledRect(page, 0, H - 72, W, 72, C.teal)
  page.drawText('REGISTRATION FORM', {
    x: 40, y: H - 44, size: 24, font: fonts.notoSansBold, color: C.white,
  })
  page.drawText('Please complete all fields. Use BLOCK CAPITALS.', {
    x: 40, y: H - 62, size: 9, font: fonts.notoSansItalic, color: rgb(0.82, 0.92, 0.92),
  })

  let y = H - 110

  // Section 1: Applicant
  page.drawText('1. APPLICANT', { x: 40, y, size: 10, font: fonts.notoSansBold, color: C.teal })
  drawHRule(page, 40, y - 4, W - 80, C.teal, 1)
  y -= 22

  const fields1 = [
    ['First Name',     'JAYQUAN'],
    ['Last Name',      'MCCLEARY'],
    ['Date of Birth',  '14 / 11 / 1999'],
    ['Place of Birth', 'KINGSTON, JAMAICA'],
    ['Nationality',    'JAMAICAN'],
    ['Passport No.',   'A1234567B'],
    ['Email',          'jayquanmccleary1@gmail.com'],
    ['Phone',          '+1 (876) 555-0100'],
  ]
  drawFieldGrid(page, fonts, 40, y, W - 80, fields1)
  y -= Math.ceil(fields1.length / 2) * 22 + 18

  // Section 2: Address
  page.drawText('2. CURRENT ADDRESS', { x: 40, y, size: 10, font: fonts.notoSansBold, color: C.teal })
  drawHRule(page, 40, y - 4, W - 80, C.teal, 1)
  y -= 22
  const fields2 = [
    ['Street',        '4721 CONSTANT SPRING ROAD'],
    ['Apt / Unit',    'APT 3B'],
    ['City',          'KINGSTON'],
    ['Parish',        'ST ANDREW'],
    ['Postal Code',   'KGN-10'],
    ['Country',       'JAMAICA'],
  ]
  drawFieldGrid(page, fonts, 40, y, W - 80, fields2)
  y -= Math.ceil(fields2.length / 2) * 22 + 18

  // Section 3: Preferences (checkboxes)
  page.drawText('3. COMMUNICATION PREFERENCES', { x: 40, y, size: 10, font: fonts.notoSansBold, color: C.teal })
  drawHRule(page, 40, y - 4, W - 80, C.teal, 1)
  y -= 22

  const prefs = [
    { label: 'Email newsletter',       checked: true },
    { label: 'SMS updates',            checked: false },
    { label: 'Printed correspondence', checked: true },
    { label: 'Share with partners',    checked: false },
  ]
  prefs.forEach((p, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const bx = 40 + col * ((W - 80) / 2)
    const by = y - row * 20
    // Checkbox
    drawBorderedRect(page, bx, by - 10, 10, 10, C.white, C.ink, 1)
    if (p.checked) {
      // Crude check mark: two lines
      page.drawLine({ start: { x: bx + 1, y: by - 5 }, end: { x: bx + 4, y: by - 9 }, thickness: 1.5, color: C.teal })
      page.drawLine({ start: { x: bx + 4, y: by - 9 }, end: { x: bx + 9, y: by - 1 }, thickness: 1.5, color: C.teal })
    }
    page.drawText(p.label, { x: bx + 16, y: by - 8, size: 10, font: fonts.notoSansRegular, color: C.ink })
  })
  y -= Math.ceil(prefs.length / 2) * 20 + 18

  // Section 4: Declaration
  page.drawText('4. DECLARATION', { x: 40, y, size: 10, font: fonts.notoSansBold, color: C.teal })
  drawHRule(page, 40, y - 4, W - 80, C.teal, 1)
  y -= 22
  wrapAndDraw(page,
    'I declare that the information provided above is true, complete, and accurate to the best of my knowledge. ' +
    'I understand that providing false information may result in the termination of my application.',
    40, y, W - 80, 10, fonts.notoSansRegular, C.ink, 13,
  )
  y -= 50

  // Signature line
  drawHRule(page, 40, y, 220, C.ink, 0.8)
  page.drawText('Signature', { x: 40, y: y - 14, size: 8, font: fonts.notoSansItalic, color: C.gray })
  drawHRule(page, W - 40 - 160, y, 160, C.ink, 0.8)
  page.drawText('Date', { x: W - 40 - 160, y: y - 14, size: 8, font: fonts.notoSansItalic, color: C.gray })

  // Footer
  drawHRule(page, 40, 56, W - 80, rgb(0.85, 0.85, 0.85), 0.5)
  page.drawText('Form ref: OS-STRESS-04 · Page 4 of 5', {
    x: 40, y: 42, size: 7, font: fonts.notoSansItalic, color: C.gray,
  })
}

function drawFieldGrid(page, fonts, x, y, totalW, pairs) {
  const colW = totalW / 2
  const rowH = 22
  pairs.forEach((pair, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const bx = x + col * colW
    const by = y - row * rowH
    page.drawText(pair[0], {
      x: bx, y: by - 4, size: 7, font: fonts.notoSansBold, color: C.gray,
    })
    page.drawText(pair[1], {
      x: bx, y: by - 16, size: 10, font: fonts.notoSansRegular, color: C.ink,
    })
    drawHRule(page, bx, by - 19, colW - 10, rgb(0.8, 0.8, 0.82), 0.5)
  })
}

// ── Page 5: Visual chaos ───────────────────────────────────────────
// Stress areas: rotated text, overlapping shapes with transparency,
// image with rotation, a fake gradient built from many thin rects,
// borders around borders.

function drawPage5(page, fonts, images) {
  const { width: W, height: H } = page.getSize()

  // Full-page gradient background built from horizontal strips
  const strips = 80
  for (let i = 0; i < strips; i++) {
    const t = i / strips
    const col = rgb(0.98 - t * 0.15, 0.94 - t * 0.2, 1 - t * 0.25)
    drawFilledRect(page, 0, H - (i + 1) * (H / strips), W, H / strips + 1, col)
  }

  // Title stamped large in the middle
  page.drawText('VISUAL', {
    x: 60, y: H - 140, size: 84, font: fonts.notoSansBold, color: C.coral, opacity: 0.85,
  })
  page.drawText('CHAOS', {
    x: 260, y: H - 220, size: 84, font: fonts.notoSansBold, color: C.deepBlue, opacity: 0.85,
  })

  // Overlapping translucent shapes
  drawFilledRect(page, 100, H - 320, 180, 140, C.gold, 0.45)
  drawFilledRect(page, 220, H - 360, 160, 140, C.teal, 0.50)
  drawFilledRect(page, 340, H - 310, 140, 120, C.purple, 0.40)

  // Rotated text at various angles
  const rotWords = [
    { text: 'compose',  x: 120, y: H - 260, deg: 12,  color: C.white },
    { text: 'compose',  x: 260, y: H - 300, deg: -8,  color: C.white },
    { text: 'compose',  x: 390, y: H - 250, deg: 24,  color: C.white },
    { text: 'compose',  x: 160, y: H - 320, deg: -15, color: C.white },
  ]
  for (const r of rotWords) {
    page.drawText(r.text, {
      x: r.x, y: r.y, size: 22, font: fonts.notoSansItalic,
      color: r.color, rotate: degrees(r.deg),
    })
  }

  // Rotated logo image
  page.drawImage(images.logo, {
    x: 380, y: H - 500, width: 110, height: 110, rotate: degrees(18),
  })

  // Border frames nested
  const fx = 40, fy = H - 560, fw = W - 80, fh = 140
  drawBorderedRect(page, fx, fy, fw, fh, C.white, C.ink, 2)
  drawBorderedRect(page, fx + 8, fy + 8, fw - 16, fh - 16, rgb(0.985, 0.985, 0.99), C.gold, 1)
  drawBorderedRect(page, fx + 18, fy + 18, fw - 36, fh - 36, C.white, rgb(0.8, 0.8, 0.85), 0.5)

  // Inside the frames: mixed-size text specimen
  const sizes = [6, 8, 10, 14, 18, 24, 32]
  let sy = fy + fh - 24
  for (const s of sizes) {
    page.drawText(`The quick brown fox jumps over the lazy dog. ${s}pt`, {
      x: fx + 28, y: sy, size: s, font: fonts.notoSerif, color: C.ink,
    })
    sy -= s + 4
  }

  // Rotated "PROOF" stamp
  page.drawText('PROOF', {
    x: W - 180, y: 180, size: 56, font: fonts.notoSansBold,
    color: C.red, rotate: degrees(-20), opacity: 0.35,
  })

  // Small monospace block in bottom-left — stresses mixed-font coverage
  drawFilledRect(page, 40, 80, 220, 50, C.ink)
  page.drawText('$ npm run tauri:dev', { x: 50, y: 110, size: 10, font: fonts.robotoMono, color: C.gold })
  page.drawText('Compiling src-tauri v0.1.0', { x: 50, y: 96, size: 8, font: fonts.robotoMono, color: C.white })

  // Footer
  drawHRule(page, 40, 56, W - 80, rgb(0.85, 0.85, 0.85), 0.5)
  page.drawText('© 2026 Acme Industries Inc. · Page 5 of 5', {
    x: 40, y: 42, size: 7, font: fonts.notoSansItalic, color: C.gray,
  })
}

// ── Text wrap util ─────────────────────────────────────────────────

function wrapAndDraw(page, text, x, y, maxW, size, font, color, lineH) {
  const words = text.split(/\s+/)
  let line = ''
  let cy = y
  for (const w of words) {
    const cand = line ? line + ' ' + w : w
    if (textWidth(cand, font, size) > maxW) {
      page.drawText(line, { x, y: cy, size, font, color })
      cy -= lineH
      line = w
    } else {
      line = cand
    }
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color })
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('Open Satchel stress-test PDF generator')
  console.log('Fonts cache:  ' + FONTS_DIR)
  console.log('Images cache: ' + IMAGES_DIR)
  console.log('Output:       ' + OUT_PATH)
  console.log()

  console.log('[1/3] Preparing fonts')
  const fontBytes = {}
  for (const key of Object.keys(FONTS)) {
    fontBytes[key] = await ensureFont(key)
  }

  console.log('\n[2/3] Preparing images')
  const imageBytes = {}
  for (const key of Object.keys(IMAGES)) {
    imageBytes[key] = ensureImage(key)
  }

  console.log('\n[3/3] Composing PDF')
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle('Open Satchel — Stress Test')
  doc.setAuthor('open-satchel stress generator')
  doc.setSubject('Adversarial fixture for paragraph-editor regression testing')
  doc.setKeywords(['stress-test', 'open-satchel', 'pdf-editor'])

  // Font embedding policy:
  //  - Latin fonts (Noto Sans family, Noto Serif, Roboto Mono): subset
  //    safely. pd-lib's subsetter handles Latin scripts cleanly and
  //    shrinks output dramatically (~40 KB per face vs ~600 KB full).
  //  - CJK (Noto Sans SC): subset:false. pd-lib's subsetter drops
  //    glyphs from the Chinese cmap even when they're drawn, producing
  //    gaps like "版 界 。 同". Cost is ~17 MB embedded, but the PDF
  //    compresses decently and this is a stress fixture anyway.
  //  - Arabic (Amiri): subset:false. Complex-script shaping requires
  //    the layout tables (GSUB/GPOS/morx) intact — subsetting these
  //    mangles contextual forms and the text renders as empty.
  const fonts = {}
  const subsetFalse = new Set(['notoSansSC', 'amiri'])
  for (const [key, bytes] of Object.entries(fontBytes)) {
    fonts[key] = await doc.embedFont(bytes, { subset: !subsetFalse.has(key) })
  }
  // Add two of the pd-lib Standard 14 so the PDF exercises BOTH embedded
  // custom fonts AND the /Type1 Standard font path the editor has to
  // handle. Courier shows up in the monospace code block if available;
  // Times Roman is a safety net for the "unknown embed?" code paths.
  fonts.courier = await doc.embedFont(StandardFonts.Courier)
  fonts.timesRoman = await doc.embedFont(StandardFonts.TimesRoman)

  const images = {
    chart: await doc.embedPng(imageBytes.chart),
    logo: await doc.embedPng(imageBytes.logo),
    photo: await doc.embedPng(imageBytes.photo),
  }

  const p1 = doc.addPage([612, 792]); drawPage1(p1, fonts, images); console.log('  page 1  Q4 EARNINGS REPORT')
  const p2 = doc.addPage([612, 792]); drawPage2(p2, fonts, images); console.log('  page 2  magazine article')
  const p3 = doc.addPage([612, 792]); drawPage3(p3, fonts);          console.log('  page 3  multilingual (EN/ZH/AR)')
  const p4 = doc.addPage([612, 792]); drawPage4(p4, fonts);          console.log('  page 4  registration form')
  const p5 = doc.addPage([612, 792]); drawPage5(p5, fonts, images); console.log('  page 5  visual chaos')

  const bytes = await doc.save()
  fs.writeFileSync(OUT_PATH, bytes)
  console.log(`\nWrote ${Math.round(bytes.length / 1024)} KB → ${OUT_PATH}`)
}

main().catch((err) => {
  console.error('\nGeneration failed:')
  console.error(err)
  process.exit(1)
})
