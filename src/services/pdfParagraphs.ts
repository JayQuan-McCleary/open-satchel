// Cluster pdfjs text items into paragraph-level bounding boxes.
//
// v2 (column-aware). The previous version grouped items into lines by
// Y proximity only, which merged columns on the same baseline into a
// single paragraph (e.g. invoice layouts with "Name..." on the left and
// "Date:..." on the right ended up as one mashed-together block).
//
// Current algorithm:
//   1. Read text items + font-style map from pdfjs.
//   2. Group items into LINE SEGMENTS by Y-proximity; within a Y-line,
//      split on X-gaps > columnGapFactor × fontSize so two visually
//      separate columns become two separate segments.
//   3. Cluster segments into PARAGRAPHS by column alignment
//      (segment.x close to previous), vertical adjacency (line gap
//      near 1× fontSize), and font-size continuity.
//   4. Emit paragraph boxes with union bboxes, resolved font family
//      (from pdfjs styles map), and a best-guess color placeholder.
//
// The output is stable and sorted top-down, left-to-right. Paragraph
// ids are position-based so they're reproducible across clustering runs.

import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}

export interface ParagraphBox {
  id: string
  itemIndices: number[]
  lines: Line[]
  bbox: { x: number; y: number; width: number; height: number }
  originalText: string
  fontSize: number
  fontName: string
  /** Resolved CSS font family from pdfjs styles map (e.g. 'Helvetica',
   *  'Times New Roman'), not the internal pdfjs id. 'sans-serif' if
   *  unknown. */
  fontFamily: string
  /** True if pdfjs reported the style as italic. */
  italic: boolean
  /** Bold heuristic: fontName contains Bold/Black/Heavy. */
  bold: boolean
  /** Sampled text color from the rendered canvas, as hex. Defaults to
   *  black when sampling hasn't run; populated by sampleParagraphColors
   *  after the canvas is available. */
  color: string
  /** True when we detected a dark background behind this paragraph, so
   *  the editor can render edits in white-on-dark without the user
   *  having to set color manually. */
  onDarkBackground: boolean
  /** Sampled background color (hex). Used by save to paint an
   *  invisible-on-the-real-background mask over the original text
   *  before drawing the replacement. Avoids the white-rect-on-dark-
   *  header bug. */
  backgroundColor: string
}

export interface Line {
  y: number
  fontSize: number
  text: string
  itemIndices: number[]
  x: number
  width: number
}

export interface ClusteringOptions {
  /** Fraction of fontSize allowed as y-delta within the same line. */
  lineTolerance?: number
  /** Fraction of fontSize allowed as gap before we split paragraphs. */
  paragraphGapFactor?: number
  /** Multiple of fontSize that counts as a column break within one y-line. */
  columnGapFactor?: number
  /** Max x-offset (in px) between line segments to consider them in the
   *  same column when forming paragraphs. */
  columnAlignmentTolerance?: number
}

const DEFAULT_OPTS: Required<ClusteringOptions> = {
  lineTolerance: 0.4,
  paragraphGapFactor: 1.8,
  columnGapFactor: 2.2,
  columnAlignmentTolerance: 8,
}

// pdfjs's `textContent.styles` is keyed by the same id as item.fontName.
interface PdfjsStyle {
  fontFamily?: string
  ascent?: number
  descent?: number
  vertical?: boolean
}

function itemGeometry(item: TextItem, pageHeight: number) {
  const [a, , , d, e, f] = item.transform
  const fontSize = Math.abs(d) || Math.abs(a)
  const yTop = pageHeight - f - fontSize
  const xLeft = e
  return {
    x: xLeft,
    y: yTop,
    width: Math.max(item.width, 1),
    height: fontSize * 1.2,
    fontSize,
    baselineY: pageHeight - f,
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>()
  let best: T = values[0]
  let bestCount = 0
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1
    counts.set(v, c)
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

// pdfjs font family strings are often bare names ('Helvetica') — pick a
// sensible fallback stack so browser rendering is close to canvas.
function normalizeFontFamily(family: string | undefined): string {
  if (!family) return `-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`
  // Serif-ish keywords → serif stack; monospace → monospace; else sans.
  const f = family.toLowerCase()
  if (/times|serif|garamond|georgia|book|cambria|palatino/.test(f)) {
    return `'${family}', 'Times New Roman', Times, serif`
  }
  if (/courier|mono|console|consolas|menlo|cascadia/.test(f)) {
    return `'${family}', 'Cascadia Code', Consolas, monospace`
  }
  return `'${family}', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`
}

function isBoldName(fontName: string): boolean {
  return /bold|black|heavy|semibold/i.test(fontName)
}

function isItalicName(fontName: string): boolean {
  return /italic|oblique/i.test(fontName)
}

/**
 * Sample the rendered canvas to infer each paragraph's text color.
 *
 * pdfjs's text items don't carry color information (it lives in the
 * graphics-state colorspace ops of the content stream, which pdfjs
 * doesn't expose on TextContent). So to preserve things like "Invoice"
 * white-on-dark in the header, we sample the raster and derive the
 * text color from background luminance:
 *   - Dark background → text is probably white.
 *   - Light background → text is probably black.
 *
 * This heuristic covers ~99% of real documents. A proper solution
 * would parse the content stream for the sg/rg/k ops preceding each
 * Tj — deferred until someone hits a mid-luminance edge case.
 *
 * `canvas` is the rendered PDF canvas. `pageWidth` is the bbox
 * coordinate space (scale=1 viewport). We derive the bitmap-to-bbox
 * ratio from canvas.width / pageWidth.
 */
export function sampleParagraphColors(
  canvas: HTMLCanvasElement,
  paragraphs: ParagraphBox[],
  pageWidth: number,
): ParagraphBox[] {
  const ctx = canvas.getContext('2d')
  if (!ctx || pageWidth <= 0 || canvas.width <= 0) return paragraphs
  const scale = canvas.width / pageWidth
  // We read the whole bbox region into an ImageData once per paragraph
  // and inspect luminance. Sampling single pixels is flaky because the
  // first glyph might not land exactly where we poke.
  return paragraphs.map((p) => {
    try {
      // Sample a strip ABOVE the paragraph to read the background.
      const bgX = Math.max(0, Math.round(p.bbox.x * scale))
      const bgY = Math.max(0, Math.round((p.bbox.y - Math.max(2, p.fontSize * 0.3)) * scale))
      const bgW = Math.min(canvas.width - bgX, Math.max(2, Math.round(p.bbox.width * scale)))
      const bgH = Math.min(canvas.height - bgY, Math.max(2, Math.round(p.fontSize * 0.3 * scale)))
      if (bgW <= 0 || bgH <= 0) return p
      const bg = ctx.getImageData(bgX, bgY, bgW, bgH).data
      let bgLum = 0
      let count = 0
      for (let i = 0; i < bg.length; i += 4) {
        const a = bg[i + 3] / 255
        if (a < 0.1) continue // transparent → ignore
        const r = bg[i], g = bg[i + 1], b = bg[i + 2]
        bgLum += (0.299 * r + 0.587 * g + 0.114 * b) / 255
        count++
      }
      if (count === 0) return p
      bgLum /= count
      const isDark = bgLum < 0.5
      // Compute the actual bg RGB mean so save can draw a matching
      // rectangle over the paragraph (invisible on both dark and light
      // backgrounds) instead of a hard-coded white rect.
      let rSum = 0, gSum = 0, bSum = 0, cnt = 0
      for (let i = 0; i < bg.length; i += 4) {
        const a = bg[i + 3] / 255
        if (a < 0.1) continue
        rSum += bg[i]; gSum += bg[i + 1]; bSum += bg[i + 2]; cnt++
      }
      const avgR = cnt > 0 ? rSum / cnt / 255 : 1
      const avgG = cnt > 0 ? gSum / cnt / 255 : 1
      const avgB = cnt > 0 ? bSum / cnt / 255 : 1
      const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
      return {
        ...p,
        color: isDark ? '#ffffff' : '#000000',
        onDarkBackground: isDark,
        backgroundColor: `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`,
      }
    } catch {
      // CORS-tainted canvas or other getImageData failure → leave defaults.
      return p
    }
  })
}

export async function clusterParagraphs(
  pdfDoc: PDFDocumentProxy,
  pageIndex: number,
  options: ClusteringOptions = {},
): Promise<{ paragraphs: ParagraphBox[]; pageWidth: number; pageHeight: number; items: TextItem[] }> {
  const opts = { ...DEFAULT_OPTS, ...options }
  const page = await pdfDoc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const pageWidth = viewport.width
  const pageHeight = viewport.height
  const textContent = await page.getTextContent()
  const items = textContent.items as unknown as TextItem[]
  const styles = (textContent.styles ?? {}) as Record<string, PdfjsStyle>
  page.cleanup()

  type ItemPlus = {
    orig: number
    item: TextItem
    geom: ReturnType<typeof itemGeometry>
  }
  const enriched: ItemPlus[] = []
  items.forEach((it, i) => {
    if (!it.str || !it.str.length) return
    enriched.push({ orig: i, item: it, geom: itemGeometry(it, pageHeight) })
  })

  // Sort by y (top-down) with ties broken by x (left-right).
  enriched.sort((a, b) => {
    const yDiff = a.geom.y - b.geom.y
    if (Math.abs(yDiff) > Math.min(a.geom.fontSize, b.geom.fontSize) * opts.lineTolerance) {
      return yDiff
    }
    return a.geom.x - b.geom.x
  })

  // Line segments: group by Y, then split on large X gaps.
  // A "segment" is a contiguous run of items that share a baseline AND
  // aren't separated by a wide horizontal gap. Two columns on the same
  // physical line become two segments, not one.
  type Segment = {
    yTop: number
    baselineY: number
    fontSize: number
    items: ItemPlus[]
    xLeft: number
    xRight: number
  }
  const segments: Segment[] = []
  let currentYLine: ItemPlus[] = []
  let currentBaseline: number | null = null
  let currentFontSize = 0

  const flushYLine = () => {
    if (currentYLine.length === 0) return
    // Sort by x to walk left-to-right.
    currentYLine.sort((a, b) => a.geom.x - b.geom.x)
    // Split this y-line into segments wherever an x-gap exceeds the
    // column-gap threshold.
    let segStart = 0
    for (let i = 1; i < currentYLine.length; i++) {
      const prev = currentYLine[i - 1]
      const cur = currentYLine[i]
      const gap = cur.geom.x - (prev.geom.x + prev.geom.width)
      const threshold = Math.max(prev.geom.fontSize, cur.geom.fontSize) * opts.columnGapFactor
      if (gap > threshold) {
        segments.push(buildSegment(currentYLine.slice(segStart, i)))
        segStart = i
      }
    }
    segments.push(buildSegment(currentYLine.slice(segStart)))
    currentYLine = []
    currentBaseline = null
    currentFontSize = 0
  }

  const buildSegment = (its: ItemPlus[]): Segment => {
    const xLeft = its[0].geom.x
    const last = its[its.length - 1]
    const xRight = last.geom.x + last.geom.width
    const yTop = Math.min(...its.map((i) => i.geom.y))
    const baseline = median(its.map((i) => i.geom.baselineY))
    const fontSize = median(its.map((i) => i.geom.fontSize))
    return { yTop, baselineY: baseline, fontSize, items: its, xLeft, xRight }
  }

  for (const it of enriched) {
    const tol = it.geom.fontSize * opts.lineTolerance
    if (currentBaseline !== null && Math.abs(it.geom.baselineY - currentBaseline) <= tol) {
      currentYLine.push(it)
      currentFontSize = Math.max(currentFontSize, it.geom.fontSize)
    } else {
      flushYLine()
      currentYLine = [it]
      currentBaseline = it.geom.baselineY
      currentFontSize = it.geom.fontSize
    }
  }
  flushYLine()

  // Sort segments top-down, left-to-right for deterministic cluster output.
  segments.sort((a, b) => {
    const yDiff = a.yTop - b.yTop
    if (Math.abs(yDiff) > Math.min(a.fontSize, b.fontSize) * opts.lineTolerance) return yDiff
    return a.xLeft - b.xLeft
  })

  // Cluster segments into paragraphs.
  // Rules to stay in the same paragraph:
  //   - column alignment: |this.xLeft - prev.xLeft| <= columnAlignmentTolerance
  //   - vertical adjacency: gap between baselines ≈ 1× fontSize, up to
  //     paragraphGapFactor× before we split
  //   - font-size continuity: ratio not > 1.5 (bigger → heading break)
  const paragraphs: ParagraphBox[] = []
  let currentPara: Segment[] = []
  const flushPara = () => {
    if (currentPara.length === 0) return
    const itemIndices: number[] = []
    const allLines: Line[] = []
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    const fontSizes: number[] = []
    const fontNames: string[] = []
    const texts: string[] = []
    for (const seg of currentPara) {
      const lineText = seg.items.map((i) => i.item.str).join('')
      const lineItemIdx = seg.items.map((i) => i.orig)
      allLines.push({
        y: seg.yTop,
        fontSize: seg.fontSize,
        text: lineText,
        itemIndices: lineItemIdx,
        x: seg.xLeft,
        width: seg.xRight - seg.xLeft,
      })
      texts.push(lineText)
      for (const it of seg.items) {
        itemIndices.push(it.orig)
        fontSizes.push(it.geom.fontSize)
        fontNames.push(it.item.fontName)
        minX = Math.min(minX, it.geom.x)
        minY = Math.min(minY, it.geom.y)
        // Only extend the paragraph's right edge for items that actually
        // render glyphs. pdfjs reports layout-gap whitespace as items
        // with large widths (e.g. between "Invoice" and "Date:" in the
        // invoice header we saw a single " " with width=239 filling the
        // inter-column space). Including that in maxX makes our save-time
        // mask rect cover the next column too — visible bug where
        // editing "Invoice" wipes out the "Date:" label. Skip those.
        const isWhitespaceOnly = !it.item.str || /^\s*$/.test(it.item.str)
        if (!isWhitespaceOnly) {
          maxX = Math.max(maxX, it.geom.x + it.geom.width)
        }
        maxY = Math.max(maxY, it.geom.y + it.geom.height)
      }
    }
    // If every item was whitespace (rare), fall back to the segment's
    // geometric right edge so the bbox still has non-zero width.
    if (maxX === -Infinity) {
      for (const seg of currentPara) {
        maxX = Math.max(maxX, seg.xRight)
      }
    }
    const fontName = mostCommon(fontNames)
    const style = styles[fontName] ?? {}
    const medFontSize = median(fontSizes)
    // Bold detection: pdfjs's internal fontName ('g_d0_f1' etc.) almost
    // never contains 'bold', so the isBoldName(fontName) check rarely
    // fires on real PDFs. Fall back to three signals:
    //   1. Resolved fontFamily from the styles map (e.g. 'Helvetica-Bold')
    //   2. fontName containing 'bold'/'black'/'heavy' (covers some PDFs)
    //   3. Large font size as a weak heading heuristic — titles/headers
    //      are almost always bold in designed documents.
    const resolvedFamily = style.fontFamily ?? ''
    const bold =
      isBoldName(fontName) ||
      isBoldName(resolvedFamily) ||
      medFontSize >= 20
    paragraphs.push({
      id: `p_${pageIndex}_${Math.round(minX)}_${Math.round(minY)}`,
      itemIndices,
      lines: allLines,
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      originalText: texts.join('\n'),
      fontSize: medFontSize,
      fontName,
      fontFamily: normalizeFontFamily(style.fontFamily),
      bold,
      italic: isItalicName(fontName) || isItalicName(resolvedFamily),
      color: '#000000',
      onDarkBackground: false,
      backgroundColor: '#ffffff',
    })
    currentPara = []
  }

  let prev: Segment | null = null
  for (const seg of segments) {
    if (!prev) {
      currentPara = [seg]
      prev = seg
      continue
    }
    const colAligned = Math.abs(seg.xLeft - prev.xLeft) <= opts.columnAlignmentTolerance
    const expectedGap = (prev.fontSize + seg.fontSize) / 2
    // gap between baselines — prev is higher-up on screen (smaller y),
    // seg below it. Expected line-to-line gap ≈ fontSize × 1.0–1.4.
    const baselineGap = seg.baselineY - prev.baselineY
    // baselineY is pageHeight - PDF-Y so increases top-to-bottom.
    const gapOk = baselineGap > 0 && baselineGap <= expectedGap * opts.paragraphGapFactor
    const fontSizeRatio =
      Math.max(prev.fontSize, seg.fontSize) /
      Math.max(Math.min(prev.fontSize, seg.fontSize), 1)
    const sizeCompat = fontSizeRatio <= 1.5
    if (colAligned && gapOk && sizeCompat) {
      currentPara.push(seg)
    } else {
      flushPara()
      currentPara = [seg]
    }
    prev = seg
  }
  flushPara()

  return { paragraphs, pageWidth, pageHeight, items }
}
