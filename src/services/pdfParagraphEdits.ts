// Apply paragraph-level text edits to PDF bytes on save.
//
// Architecture: EditableParagraphLayer (UI) stores edits of the form
//   { paragraphId, bbox, originalText, newText, fontSize, fontName }
// per page, in `_paragraphEdits` on PdfPageState. This service consumes
// those edits and produces new PDF bytes.
//
// Strategy (matches Acrobat's block-level repaint):
//   1. Draw a white rectangle covering the paragraph bbox — obliterates
//      the original glyphs in the saved PDF, regardless of font encoding.
//   2. Draw the new text inside the rect using a system-available
//      fallback font (Helvetica by default; user-configurable in M2+).
//      We manually wrap lines to fit the original bbox width, preserving
//      the original layout as closely as a fallback font allows.
//
// Trade-offs:
//   - Simpler than in-place content-stream rewriting and not dependent on
//     the original font being present.
//   - Substituted text won't match original font metrics exactly (same
//     complaint Acrobat users have with its fallback to Minion Pro).
//   - For paragraphs where the original font is available (M2 font
//     import), we skip the whiteout and use the real embedded font.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// NOTE: applyTextEditsToBytes was used here to blank original ops at
// save time, but its pdfjs-item-index → parser-textRun-index mapping
// proved unreliable (pdfjs inserts synthetic whitespace items that the
// parser doesn't see, causing misaligned blanking). See the
// applyParagraphEditsToBytes body for the full rationale.

export interface ParagraphEdit {
  paragraphId: string
  /** Paragraph bbox in pdfjs viewport coords (top-left origin, scale=1). */
  bbox: { x: number; y: number; width: number; height: number }
  originalText: string
  newText: string
  /** Font size from the original paragraph (PDF user-space units). */
  fontSize: number
  /** Text color hex (sampled from canvas — white on dark bg, black on light). */
  color?: string
  /** Background color hex (sampled from canvas — used for the "whiteout"
   *  rect which is actually whatever-color-the-background-is to blend in). */
  backgroundColor?: string
  /** True when the original paragraph was bold/heading; save picks a
   *  bold variant of the fallback font to preserve visual weight. */
  bold?: boolean
  /** True when the original paragraph was italic. */
  italic?: boolean
  /** pdfjs TextLayer indices of every item that belongs to this paragraph. */
  itemIndices?: number[]
  /** Original text for each item — same length as itemIndices. */
  itemOriginalTexts?: string[]
}

export interface ApplyParagraphOptions {
  /** Fallback system font for substitution when the original isn't available. */
  fallbackFont?: keyof typeof StandardFonts
  /**
   * Optional pdfjs document for the content-stream rewrite + whiteout
   * fallback path. When provided, we ask applyTextEditsToBytes to blank
   * the original content-stream ops before we draw the replacement, so
   * pdfjs can't extract ghost text on subsequent edits.
   */
  pdfjsDoc?: PDFDocumentProxy | null
}

function hexToRgb01(hex: string | undefined): { r: number; g: number; b: number } {
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
    return { r: 0, g: 0, b: 0 }
  }
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
}

/** Break text into lines that fit within maxWidth when rendered in `font` at `size`. */
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  // Preserve explicit newlines; wrap each paragraph-line separately.
  const paragraphs = text.split('\n')
  const out: string[] = []
  for (const para of paragraphs) {
    if (para.length === 0) {
      out.push('')
      continue
    }
    const words = para.split(/(\s+)/) // keep whitespace groups for round-trip spacing
    let current = ''
    for (const w of words) {
      const candidate = current + w
      const width = font.widthOfTextAtSize(candidate, size)
      if (width <= maxWidth || current.length === 0) {
        current = candidate
      } else {
        out.push(current.trimEnd())
        current = w.trimStart()
      }
    }
    if (current.length > 0) out.push(current)
  }
  return out
}

export async function applyParagraphEditsToBytes(
  pdfBytes: Uint8Array,
  pageIndex: number,
  edits: ParagraphEdit[],
  options: ApplyParagraphOptions = {},
): Promise<Uint8Array> {
  if (edits.length === 0) return pdfBytes

  // Deliberately NO content-stream blanking here.
  //
  // Earlier versions called applyTextEditsToBytes to rewrite each item's
  // Tj operator to an empty string, then drew a whiteout + new text on
  // top. Two problems turned up in testing:
  //   1. pdfjs emits synthetic whitespace items between real Tj ops (e.g.
  //      a single " " item with width=239 filling the inter-column gap
  //      between "Invoice" and "Date:" in the invoice header). Those
  //      aren't in parser.textRuns, so spanIndex → textRun index drifts.
  //      Blanking parser.textRuns[N] then blanks some UNRELATED real Tj
  //      like the "Date:" label — which visibly disappears on save.
  //   2. Re-extracting with pdfjs on the saved bytes picks up both the
  //      original (failed-to-blank) Tj and the new drawText, so clustering
  //      sees ghost duplicates.
  //
  // Solution: skip the content-stream rewrite entirely and rely on a
  // background-colored mask rectangle (drawn below in the edit loop) to
  // hide the original glyphs visually. The original Tj ops stay in the
  // content stream but are rendered invisibly because the mask covers
  // them; text-extraction tools still see the original text, which is
  // acceptable for an editor that targets visual fidelity first.
  //
  // If we ever need clean extraction on saved files (e.g. for a
  // searchable-PDF pipeline), we'll add a proper content-stream rewriter
  // that works on a parser-derived index, not on pdfjs's item index.
  let workingBytes = pdfBytes

  const doc = await PDFDocument.load(workingBytes)
  const pdfPage = doc.getPage(pageIndex)
  const { height: pageHeight } = pdfPage.getSize()

  const fallbackName = options.fallbackFont ?? 'Helvetica'
  // Pre-embed all four style variants so we can pick per-edit based on
  // the paragraph's detected bold/italic flags. Only the requested
  // variants actually get written into the output; pdf-lib lazy-
  // serializes embedded fonts.
  const fontPlain = await doc.embedFont(StandardFonts[fallbackName])
  const fontBold = await doc.embedFont(
    fallbackName === 'Helvetica' ? StandardFonts.HelveticaBold
      : fallbackName === 'TimesRoman' ? StandardFonts.TimesRomanBold
      : StandardFonts.CourierBold,
  )
  const fontItalic = await doc.embedFont(
    fallbackName === 'Helvetica' ? StandardFonts.HelveticaOblique
      : fallbackName === 'TimesRoman' ? StandardFonts.TimesRomanItalic
      : StandardFonts.CourierOblique,
  )
  const fontBoldItalic = await doc.embedFont(
    fallbackName === 'Helvetica' ? StandardFonts.HelveticaBoldOblique
      : fallbackName === 'TimesRoman' ? StandardFonts.TimesRomanBoldItalic
      : StandardFonts.CourierBoldOblique,
  )
  const pickFont = (bold: boolean, italic: boolean): PDFFont => {
    if (bold && italic) return fontBoldItalic
    if (bold) return fontBold
    if (italic) return fontItalic
    return fontPlain
  }

  for (const edit of edits) {
    // Convert viewport top-left origin → pdf user-space bottom-left origin.
    const pdfY = pageHeight - edit.bbox.y - edit.bbox.height
    const { x, width, height } = edit.bbox

    // Draw a MASK rectangle over the paragraph in the detected
    // BACKGROUND color. On the dark invoice header this draws a dark
    // rect (invisible against the black bar); on white body paragraphs
    // it draws a white rect (invisible against the page).
    //
    // This sidesteps the content-stream blanking's index-mismatch bug
    // (pdfjs emits synthetic space items that the parser doesn't see,
    // so spanIndex → textRun index mapping is unreliable in practice
    // — blanking the wrong run leaves the original "Invoice" text
    // alive in the content stream and you get "InvoiceINV 2026" after
    // save). By painting the exact bg color over the bbox, we fully
    // mask the original glyphs regardless of how the content stream
    // is structured, without any visible rect.
    const bg = hexToRgb01(edit.backgroundColor ?? '#ffffff')
    // Pad generously — pdfjs's item.width is the advance width and
    // doesn't cover all glyph bearings. 25% of fontSize vertically +
    // 25% of width horizontally covers metric differences and any
    // overhangs.
    // Keep padding modest on the right so the mask doesn't bleed into
    // neighbouring paragraphs (e.g. "Invoice" title and "Date:" column
    // sit very close horizontally). Clustering already trims trailing
    // whitespace from the bbox's right edge, so the bbox itself is
    // accurate; these are just antialiasing + metric-mismatch buffers.
    const padY = Math.max(3, edit.fontSize * 0.25)
    const padX = Math.max(2, edit.fontSize * 0.15)
    const widthBuffer = Math.min(edit.fontSize * 0.3, 6)
    pdfPage.drawRectangle({
      x: x - padX,
      y: pdfY - padY,
      width: width + padX * 2 + widthBuffer,
      height: height + padY * 2,
      color: rgb(bg.r, bg.g, bg.b),
      opacity: 1,
    })

    // 2. Draw new text inside the bbox.
    if (edit.newText.trim()) {
      const color = hexToRgb01(edit.color)
      // Use the original fontSize — fallback font metrics will differ but
      // the baseline/line spacing stays consistent with the rest of the page.
      const size = Math.max(6, Math.min(edit.fontSize, 72))
      const lineHeight = size * 1.2
      const font = pickFont(!!edit.bold, !!edit.italic)
      const lines = wrapLines(edit.newText, font, size, width)

      // Draw top-down. pdf-lib's y is the text baseline, so we start at
      // the top of the bbox and step down by lineHeight per line.
      let baselineY = pdfY + height - size
      drawLines: for (const line of lines) {
        if (baselineY < pdfY) break drawLines // ran out of vertical space
        pdfPage.drawText(line, {
          x,
          y: baselineY,
          size,
          font,
          color: rgb(color.r, color.g, color.b),
        })
        baselineY -= lineHeight
      }
    }
  }

  const out = await doc.save()
  return new Uint8Array(out)
}

/** Convenience: apply paragraph edits across all pages in one pass. */
export async function applyAllParagraphEdits(
  pdfBytes: Uint8Array,
  editsByPage: Map<number, ParagraphEdit[]>,
  options: ApplyParagraphOptions = {},
): Promise<Uint8Array> {
  let working = pdfBytes
  for (const [pageIndex, edits] of editsByPage) {
    if (edits.length === 0) continue
    working = await applyParagraphEditsToBytes(working, pageIndex, edits, options)
  }
  return working
}

// (intentionally unused import to keep PDFPage in scope for future helpers
// that operate on a loaded page directly)
void (null as unknown as PDFPage)
