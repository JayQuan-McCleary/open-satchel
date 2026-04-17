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
import { applyTextEditsToBytes, type TextLayerEdit } from './pdfTextEdits'

export interface ParagraphEdit {
  paragraphId: string
  /** Paragraph bbox in pdfjs viewport coords (top-left origin, scale=1). */
  bbox: { x: number; y: number; width: number; height: number }
  originalText: string
  newText: string
  /** Font size from the original paragraph (PDF user-space units). */
  fontSize: number
  /** Color hex if known; defaults to black. */
  color?: string
  /**
   * pdfjs TextLayer indices of every item that belongs to this paragraph.
   * Used at save time to blank those runs in the content stream so pdfjs
   * doesn't extract ghost text on the next edit. Emitted by the clustering
   * service when a paragraph is edited.
   */
  itemIndices?: number[]
  /**
   * Original text for each item — same length as itemIndices — so we can
   * build TextLayerEdits that blank the right runs without re-parsing.
   */
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

  // Phase 1: blank the original text's content-stream operators so that
  // pdfjs re-extraction on future edits doesn't find the old glyphs.
  // Without this, our whiteout + redraw approach leaves a "ghost" copy
  // of the original text alive in the content stream — visually masked
  // by the white rect, but still in the document. Clustering on the
  // saved PDF then sees both copies and produces duplicate paragraphs.
  //
  // We convert every item in every edited paragraph into a TextLayerEdit
  // that replaces its text with "". applyTextEditsToBytes handles both
  // the standard-encoded path (rewrite Tj) and the CMap/hex path
  // (whiteout + redraw with Helvetica). For paragraph edits the CMap
  // whiteout would duplicate work, but the second rect is harmless —
  // same white-on-white — and cheaper than a separate code path.
  let workingBytes = pdfBytes
  const blankEdits: TextLayerEdit[] = []
  for (const edit of edits) {
    if (!edit.itemIndices || !edit.itemOriginalTexts) continue
    const n = Math.min(edit.itemIndices.length, edit.itemOriginalTexts.length)
    for (let i = 0; i < n; i++) {
      blankEdits.push({
        spanIndex: edit.itemIndices[i],
        originalText: edit.itemOriginalTexts[i],
        newText: '',
      })
    }
  }
  if (blankEdits.length > 0) {
    workingBytes = await applyTextEditsToBytes(
      workingBytes,
      pageIndex,
      blankEdits,
      options.pdfjsDoc ?? null,
    )
  }

  const doc = await PDFDocument.load(workingBytes)
  const pdfPage = doc.getPage(pageIndex)
  const { height: pageHeight } = pdfPage.getSize()

  const fallbackName = options.fallbackFont ?? 'Helvetica'
  const font = await doc.embedFont(StandardFonts[fallbackName])

  for (const edit of edits) {
    // Convert viewport top-left origin → pdf user-space bottom-left origin.
    const pdfY = pageHeight - edit.bbox.y - edit.bbox.height
    const { x, width, height } = edit.bbox

    // NOTE: prior versions drew a big white rect here as a whiteout.
    // That ran BEFORE we had content-stream blanking (the step 1 above
    // via applyTextEditsToBytes), so painting white was the only way to
    // hide the original glyphs.
    //
    // Now that step 1 actually removes the operators, the whiteout is
    // redundant — and worse, it broke dark-background paragraphs by
    // painting a white rectangle on top of e.g. the black invoice
    // header bar (see screenshot from live testing: editing "Invoice"
    // turned the whole header into a white strip).
    //
    // For CMap-encoded runs, applyTextEditsToBytes already draws
    // targeted per-item whiteouts inside itself — small rects on each
    // glyph run, not a fat paragraph-sized rect. That's tight enough to
    // not damage surrounding layout.
    //
    // TL;DR: we rely on step 1 to erase, and only redraw text here.

    // 2. Draw new text inside the bbox.
    if (edit.newText.trim()) {
      const color = hexToRgb01(edit.color)
      // Use the original fontSize — fallback font metrics will differ but
      // the baseline/line spacing stays consistent with the rest of the page.
      const size = Math.max(6, Math.min(edit.fontSize, 72))
      const lineHeight = size * 1.2
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
