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
import fontkit from '@pdf-lib/fontkit'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  parseContentStream,
  serializeContentStream,
  applyTextReplacement,
  getPageContentBytes,
  replacePageContents,
  encodeTextToBytes,
} from './contentStreamParser'
import { resolveSystemFont } from './pdfFontResolution'

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

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
  /** Resolved CSS font family from the original paragraph's pdfjs
   *  styles map (e.g. "'Helvetica', -apple-system, ..."). Used by the
   *  save pipeline to look up a matching installed system font for
   *  re-embedding; null/missing → Helvetica Standard fallback. */
  fontFamily?: string
  /** True when the original paragraph was bold/heading; save picks a
   *  bold variant of the fallback font to preserve visual weight. */
  bold?: boolean
  /** True when the original paragraph was italic. */
  italic?: boolean
  /** Alignment within the paragraph bbox. Default 'left'. 'justify' spreads
   *  intra-word space to fill the line width (last line left-aligned). */
  align?: TextAlign
  /** pdfjs TextLayer indices of every item that belongs to this paragraph. */
  itemIndices?: number[]
  /** Original text for each item — same length as itemIndices. */
  itemOriginalTexts?: string[]
  /** User-dragged displacement from the original bbox, in viewport
   *  (scale=1) coordinates. Only the draw position moves; blanking and
   *  masking still happen at the original bbox so ghost text is removed
   *  from the spot it started, and the new text appears wherever the user
   *  dropped it. dy is positive-down (viewport convention); save converts
   *  to PDF user-space. */
  positionDelta?: { dx: number; dy: number }
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

  // Phase 1: blank the original text by POSITION (not by index).
  //
  // Earlier approach tried index-based blanking via pdfjs spanIndex →
  // parser textRun index, but those streams diverge (pdfjs emits
  // synthetic whitespace items that the parser never sees). The fix:
  // the parser gives each textRun a PDF-user-space (x, y); we blank
  // every run whose position falls INSIDE the paragraph's bbox.
  // Position-matching is robust regardless of how many synthetic items
  // pdfjs adds, and it doesn't over-reach because the bbox is already
  // tight to the visible glyphs.
  //
  // Previously the "safety" variant just painted a background-color
  // mask rect and skipped blanking altogether. That produced visually
  // clean canvas renders but left the original text alive in the
  // content stream, so re-entering Edit mode showed "Invoice" +
  // "Statement" overlapping when pdfjs re-extracted text. With
  // position-based blanking, the saved PDF has NO "Invoice" Tj in the
  // content stream — clean extraction, clean re-edit.
  let workingBytes = pdfBytes
  {
    const prebBlankDoc = await PDFDocument.load(workingBytes)
    const prebBlankPage = prebBlankDoc.getPage(pageIndex)
    const { height: pageH } = prebBlankPage.getSize()
    const streamData = getPageContentBytes(prebBlankDoc, pageIndex)
    if (streamData) {
      const parsed = parseContentStream(streamData.bytes)
      let modified = false
      for (const edit of edits) {
        // Convert viewport-top-left bbox → PDF user-space Y range.
        const padY = Math.max(3, edit.fontSize * 0.25)
        const padX = Math.max(2, edit.fontSize * 0.15)
        const xMin = edit.bbox.x - padX
        const xMax = edit.bbox.x + edit.bbox.width + padX
        const yMinPdf = pageH - (edit.bbox.y + edit.bbox.height) - padY
        const yMaxPdf = pageH - edit.bbox.y + padY
        for (const run of parsed.textRuns) {
          if (run.x >= xMin && run.x <= xMax && run.y >= yMinPdf && run.y <= yMaxPdf) {
            applyTextReplacement(parsed, run.opIndex, encodeTextToBytes(''), run.tjElementIndex)
            modified = true
          }
        }
      }
      if (modified) {
        const newStream = serializeContentStream(parsed.operators, streamData.bytes)
        // replacePageContents flattens PDFArray-backed page content (which
        // pd-lib emits after each round-trip when we call drawText) into a
        // single stream. writePageContentBytes only wrote to the first
        // array entry, letting text drawn into later entries (like the
        // "Statement" we added on the previous save) survive blanking on
        // the next save — that's the "Statement Receipt" stacked-ghost
        // bug caught in live testing.
        replacePageContents(prebBlankDoc, pageIndex, newStream)
        workingBytes = new Uint8Array(await prebBlankDoc.save())
      }
    }
  }

  const doc = await PDFDocument.load(workingBytes)
  // pd-lib needs fontkit to embed non-Standard (TrueType/OpenType) fonts.
  // Registering is cheap and safe to call unconditionally; if fontkit
  // itself fails to init (rare; happens on very old bundlers) we catch
  // and the resolveSystemFont path returns null → Standard fallback.
  try {
    doc.registerFontkit(fontkit as unknown as Parameters<typeof doc.registerFontkit>[0])
  } catch {
    /* noop — fallback path handles missing fontkit */
  }
  const pdfPage = doc.getPage(pageIndex)
  const { height: pageHeight } = pdfPage.getSize()

  const fallbackName = options.fallbackFont ?? 'Helvetica'
  // Pre-embed all four Standard-font style variants as a GUARANTEED
  // fallback. Only the variants actually referenced get serialized
  // (pdf-lib lazy-writes). System-font resolution below may supersede
  // these per-edit when a matching family is installed.
  const fontStandardPlain = await doc.embedFont(StandardFonts[fallbackName])
  const fontStandardBold = await doc.embedFont(
    fallbackName === 'Helvetica' ? StandardFonts.HelveticaBold
      : fallbackName === 'TimesRoman' ? StandardFonts.TimesRomanBold
      : StandardFonts.CourierBold,
  )
  const fontStandardItalic = await doc.embedFont(
    fallbackName === 'Helvetica' ? StandardFonts.HelveticaOblique
      : fallbackName === 'TimesRoman' ? StandardFonts.TimesRomanItalic
      : StandardFonts.CourierOblique,
  )
  const fontStandardBoldItalic = await doc.embedFont(
    fallbackName === 'Helvetica' ? StandardFonts.HelveticaBoldOblique
      : fallbackName === 'TimesRoman' ? StandardFonts.TimesRomanBoldItalic
      : StandardFonts.CourierBoldOblique,
  )
  const pickStandard = (bold: boolean, italic: boolean): PDFFont => {
    if (bold && italic) return fontStandardBoldItalic
    if (bold) return fontStandardBold
    if (italic) return fontStandardItalic
    return fontStandardPlain
  }

  // Per-save cache of embedded system fonts, keyed by resolver id. A
  // page with many paragraphs that share a family only embeds bytes
  // once, and pd-lib's embedFont is ~20 KB of work per call so this
  // matters for multi-hundred-paragraph pages.
  const systemFontCache = new Map<string, PDFFont>()
  const pickFontFor = async (edit: ParagraphEdit): Promise<PDFFont> => {
    // Resolve the original paragraph's font family against the user's
    // installed fonts. The paragraph stores its fontFamily as a CSS
    // stack ("'Helvetica', -apple-system, ..."); pdfFontResolution
    // picks off the primary name and matches by family + style.
    const family = edit.fontFamily
    if (!family) return pickStandard(!!edit.bold, !!edit.italic)
    try {
      const resolved = await resolveSystemFont(family, !!edit.bold, !!edit.italic)
      if (!resolved) return pickStandard(!!edit.bold, !!edit.italic)
      const cached = systemFontCache.get(resolved.id)
      if (cached) return cached
      // pd-lib's embedFont(bytes) produces a CustomFont; subset:false
      // embeds the full font file, which maximizes glyph coverage for
      // edits that type characters the original paragraph didn't
      // contain (e.g. adding an em-dash to a subset that only had
      // ASCII). Output size grows by the font's real size, typically
      // 30-300 KB per variant — acceptable trade for fidelity.
      const embedded = await doc.embedFont(resolved.bytes, { subset: false })
      systemFontCache.set(resolved.id, embedded)
      return embedded
    } catch {
      // Any failure (font file corrupt, fontkit doesn't like it) →
      // Standard fallback. Better to render SOMETHING legible than
      // to crash the save.
      return pickStandard(!!edit.bold, !!edit.italic)
    }
  }

  for (const edit of edits) {
    // Convert viewport top-left origin → pdf user-space bottom-left origin.
    const origPdfY = pageHeight - edit.bbox.y - edit.bbox.height
    const { x: origX, width, height } = edit.bbox

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
    //
    // The mask ALWAYS paints at the ORIGINAL bbox — that's where the
    // glyphs still live after content-stream blanking does its best
    // effort. If the paragraph was user-dragged, the text is drawn at
    // the new position further down; no second mask is needed because
    // we want the underlying page to show through there.
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
      x: origX - padX,
      y: origPdfY - padY,
      width: width + padX * 2 + widthBuffer,
      height: height + padY * 2,
      color: rgb(bg.r, bg.g, bg.b),
      opacity: 1,
    })

    // Apply the user-dragged offset for text drawing only. dx is the
    // horizontal delta in viewport units (same as bbox.x); dy is
    // positive-down in viewport space, but PDF y is positive-up, so we
    // subtract when converting.
    const dx = edit.positionDelta?.dx ?? 0
    const dy = edit.positionDelta?.dy ?? 0
    const drawX = origX + dx
    const drawPdfY = origPdfY - dy

    // 2. Draw new text at the (possibly dragged) position.
    if (edit.newText.trim()) {
      const color = hexToRgb01(edit.color)
      const size = Math.max(6, Math.min(edit.fontSize, 72))
      const lineHeight = size * 1.2
      const font = await pickFontFor(edit)
      const lines = wrapLines(edit.newText, font, size, width)
      const align: TextAlign = edit.align ?? 'left'

      // Compute per-line x offset for the chosen alignment. For justify
      // we widen intra-word spaces on all lines except the last (Word-
      // style). pdf-lib doesn't expose a native align prop across all
      // versions, so we do the geometry ourselves using widthOfTextAtSize.
      let baselineY = drawPdfY + height - size
      drawLines: for (let li = 0; li < lines.length; li++) {
        const line = lines[li]
        if (baselineY < drawPdfY) break drawLines

        if (align === 'justify' && li < lines.length - 1 && line.includes(' ')) {
          // Widen inter-word spaces to fill the full width.
          const words = line.split(' ')
          const wordsWidth = words.reduce(
            (acc, w) => acc + font.widthOfTextAtSize(w, size),
            0,
          )
          const gaps = words.length - 1
          const spaceW = (width - wordsWidth) / gaps
          let cx = drawX
          for (let w = 0; w < words.length; w++) {
            pdfPage.drawText(words[w], {
              x: cx, y: baselineY, size, font,
              color: rgb(color.r, color.g, color.b),
            })
            cx += font.widthOfTextAtSize(words[w], size) + (w < gaps ? spaceW : 0)
          }
        } else {
          const lineWidth = font.widthOfTextAtSize(line, size)
          const lineX =
            align === 'right' ? drawX + (width - lineWidth)
            : align === 'center' ? drawX + (width - lineWidth) / 2
            : drawX // left (and justify last line)
          pdfPage.drawText(line, {
            x: lineX,
            y: baselineY,
            size,
            font,
            color: rgb(color.r, color.g, color.b),
          })
        }
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
