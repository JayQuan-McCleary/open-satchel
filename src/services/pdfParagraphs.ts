// Cluster pdfjs text items into paragraph-level bounding boxes.
//
// This is the data source for Acrobat-style block editing: we look at
// every text run on a page and group runs that visually form a line,
// then group lines into paragraphs. The result is a list of paragraphs
// with bboxes that EditableParagraphLayer renders over the canvas and
// that pdfParagraphEdits uses at save time for whiteout + redraw.
//
// The algorithm deliberately stays heuristic — pdfjs doesn't expose
// paragraph structure, so we read positions and font geometry. It's the
// same approach Acrobat/Foxit/WPS use (inferred from their visible
// behavior: one bbox per "paragraph", with misgroupings that match
// what you'd get from y-delta + font-compatibility clustering).

import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface TextItem {
  str: string
  /** pdfjs transform: [a, b, c, d, e, f] where e=x, f=y in PDF user space */
  transform: number[]
  /** horizontal extent in PDF user-space units (px-equivalent at scale=1) */
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}

export interface ParagraphBox {
  id: string
  /** Indices into the original getTextContent().items array */
  itemIndices: number[]
  /** Lines grouped by y-coordinate */
  lines: Line[]
  /** Bounding box in pdfjs viewport units (top-left origin, scale=1) */
  bbox: { x: number; y: number; width: number; height: number }
  /** Original concatenated text. */
  originalText: string
  /** Best-guess font size (px at scale=1) — median over items. */
  fontSize: number
  /** pdfjs-reported font name (e.g. 'g_d0_f1'). Not a system font name. */
  fontName: string
  /** Best-guess hex color. 'unknown' when pdfjs doesn't expose color. */
  color: string
}

export interface Line {
  y: number
  fontSize: number
  text: string
  itemIndices: number[]
}

export interface ClusteringOptions {
  /** Fraction of fontSize allowed as y-delta within the same line. */
  lineTolerance?: number
  /** Fraction of fontSize allowed as gap before we split paragraphs. */
  paragraphGapFactor?: number
}

const DEFAULT_OPTS: Required<ClusteringOptions> = {
  lineTolerance: 0.4,
  paragraphGapFactor: 1.8,
}

/**
 * Compute the visible (top-left-origin) bbox and font size of a pdfjs text item.
 *
 * pdfjs's `item.transform` is `[scaleX, skewY, skewX, scaleY, e, f]` where
 * (e, f) is the baseline origin in PDF user space. Page height must be
 * provided because we flip the y-axis to top-left for rendering consumers.
 */
function itemGeometry(item: TextItem, pageHeight: number) {
  const [a, , , d, e, f] = item.transform
  const fontSize = Math.abs(d) || Math.abs(a)
  // y in top-left origin = pageHeight - (baseline + ascent)
  // Items from pdfjs are positioned at the baseline; we approximate the
  // glyph top at y - fontSize * 0.8 (ascent fraction).
  const yTop = pageHeight - f - fontSize
  const xLeft = e
  return {
    x: xLeft,
    y: yTop,
    width: Math.max(item.width, 1),
    height: fontSize * 1.2, // add descender space so bbox encloses glyphs
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

/**
 * Cluster text items on a page into paragraph bounding boxes.
 *
 * Returns paragraphs in top-to-bottom, left-to-right reading order with
 * bboxes suitable for overlaying on the canvas (top-left origin).
 */
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
  page.cleanup()

  // First pass: drop empty items, compute geometry per item, keep original
  // index so callers can correlate with pdfjs items later.
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

  // Sort by y (top to bottom), then x (left to right). Use a tolerance so
  // items on the same visual line don't sort apart due to sub-pixel y drift.
  enriched.sort((a, b) => {
    const yDiff = a.geom.y - b.geom.y
    if (Math.abs(yDiff) > Math.min(a.geom.fontSize, b.geom.fontSize) * opts.lineTolerance) {
      return yDiff
    }
    return a.geom.x - b.geom.x
  })

  // Second pass: group into lines by y proximity.
  const lines: Array<{
    yTop: number
    baselineY: number
    fontSize: number
    items: ItemPlus[]
  }> = []
  for (const it of enriched) {
    const tol = it.geom.fontSize * opts.lineTolerance
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.baselineY - it.geom.baselineY) <= tol) {
      last.items.push(it)
      last.yTop = Math.min(last.yTop, it.geom.y)
      last.fontSize = Math.max(last.fontSize, it.geom.fontSize)
    } else {
      lines.push({
        yTop: it.geom.y,
        baselineY: it.geom.baselineY,
        fontSize: it.geom.fontSize,
        items: [it],
      })
    }
  }

  // Third pass: merge consecutive lines into paragraphs when the gap
  // between them is ~1× fontSize (normal line spacing) and not too large.
  // Also splits on font-size change > 50% — headings vs body.
  const paragraphs: ParagraphBox[] = []
  let current: typeof lines | null = null
  let prevLine: (typeof lines)[number] | null = null
  const flushCurrent = () => {
    if (!current || current.length === 0) return
    const itemIndices: number[] = []
    const allLines: Line[] = []
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    const fontSizes: number[] = []
    const fontNames: string[] = []
    const texts: string[] = []
    for (const line of current) {
      const lineText = line.items.map((i) => i.item.str).join('')
      const lineFontSize = median(line.items.map((i) => i.geom.fontSize))
      const lineItemIdx = line.items.map((i) => i.orig)
      allLines.push({
        y: line.yTop,
        fontSize: lineFontSize,
        text: lineText,
        itemIndices: lineItemIdx,
      })
      texts.push(lineText)
      for (const it of line.items) {
        itemIndices.push(it.orig)
        fontSizes.push(it.geom.fontSize)
        fontNames.push(it.item.fontName)
        minX = Math.min(minX, it.geom.x)
        minY = Math.min(minY, it.geom.y)
        maxX = Math.max(maxX, it.geom.x + it.geom.width)
        maxY = Math.max(maxY, it.geom.y + it.geom.height)
      }
    }
    paragraphs.push({
      id: `p_${pageIndex}_${paragraphs.length}`,
      itemIndices,
      lines: allLines,
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      originalText: texts.join('\n'),
      fontSize: median(fontSizes),
      fontName: mostCommon(fontNames),
      color: 'unknown',
    })
    current = null
  }

  for (const line of lines) {
    if (!current) {
      current = [line]
      prevLine = line
      continue
    }
    const expectedGap = (prevLine!.fontSize + line.fontSize) / 2
    const gap = line.yTop - (prevLine!.yTop + prevLine!.fontSize * 1.2)
    const fontSizeRatio =
      Math.max(prevLine!.fontSize, line.fontSize) /
      Math.max(Math.min(prevLine!.fontSize, line.fontSize), 1)
    if (gap > expectedGap * opts.paragraphGapFactor || fontSizeRatio > 1.5) {
      flushCurrent()
      current = [line]
    } else {
      current.push(line)
    }
    prevLine = line
  }
  flushCurrent()

  return { paragraphs, pageWidth, pageHeight, items }
}
