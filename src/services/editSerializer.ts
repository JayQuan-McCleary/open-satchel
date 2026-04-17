import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { createCoordinateMapper } from './coordinateMapper'
import {
  parseContentStream, getPageContentBytes, writePageContentBytes,
  serializeContentStream, applyTextReplacement, encodeTextToBytes,
} from './contentStreamParser'
import { buildGlyphMaps, encodeWithGlyphMap } from './cmapResolver'
import type { HeaderFooterConfig } from '../formats/pdf/index'

// ── Helpers ──────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { r: 0, g: 0, b: 0 }
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  }
}

// ── Font Management ──────────────────────────────────────────────

const fontCache = new Map<string, PDFFont>()

function mapToStandardFont(
  fontFamily: string,
  bold: boolean,
  italic: boolean
): StandardFonts {
  const family = (fontFamily || 'Helvetica').toLowerCase()

  if (family.includes('times') || family.includes('serif')) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic
    if (bold) return StandardFonts.TimesRomanBold
    if (italic) return StandardFonts.TimesRomanItalic
    return StandardFonts.TimesRoman
  }

  if (family.includes('courier') || family.includes('mono')) {
    if (bold && italic) return StandardFonts.CourierBoldOblique
    if (bold) return StandardFonts.CourierBold
    if (italic) return StandardFonts.CourierOblique
    return StandardFonts.Courier
  }

  // Default: Helvetica family
  if (bold && italic) return StandardFonts.HelveticaBoldOblique
  if (bold) return StandardFonts.HelveticaBold
  if (italic) return StandardFonts.HelveticaOblique
  return StandardFonts.Helvetica
}

async function getFont(
  pdfDoc: PDFDocument,
  fontFamily: string,
  bold: boolean,
  italic: boolean,
  customFontId?: string,
  glyphs?: string
): Promise<PDFFont> {
  const cacheKey = `${fontFamily}-${bold}-${italic}-${customFontId || 'std'}`
  if (fontCache.has(cacheKey)) return fontCache.get(cacheKey)!

  let font: PDFFont

  if (customFontId) {
    try {
      let bytes: Uint8Array
      // Use IPC subsetting if glyphs are provided (main process has Node.js access for subset-font)
      if (glyphs && glyphs.length > 0 && window.api?.font?.subset) {
        bytes = await window.api.font.subset(customFontId, glyphs)
      } else {
        bytes = await window.api.font.getBytes(customFontId)
      }
      font = await pdfDoc.embedFont(bytes)
    } catch {
      // Fallback to standard font if custom fails
      font = await pdfDoc.embedFont(mapToStandardFont(fontFamily, bold, italic))
    }
  } else {
    font = await pdfDoc.embedFont(mapToStandardFont(fontFamily, bold, italic))
  }

  fontCache.set(cacheKey, font)
  return font
}

/** Scan all pages to build a map of customFontId → characters used */
function collectGlyphsPerFont(pages: any[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const page of pages) {
    if (!page.fabricJSON) continue
    const objects = (page.fabricJSON as any).objects || []
    for (const obj of objects) {
      if ((obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text') && obj.__customFontId) {
        const existing = map.get(obj.__customFontId) || ''
        map.set(obj.__customFontId, existing + (obj.text || ''))
      }
    }
  }
  // Deduplicate characters per font
  for (const [id, chars] of map) {
    map.set(id, [...new Set(chars)].join(''))
  }
  return map
}

// ── Save Options ─────────────────────────────────────────────────

export interface SerializeOptions {
  encryption?: { userPassword: string; ownerPassword: string }
  headerFooter?: HeaderFooterConfig
}

// ── Main Serialization ───────────────────────────────────────────

export async function serializeEditsToPdf(
  originalBytes: Uint8Array,
  pages: any[],
  zoom: number,
  options?: SerializeOptions
): Promise<Uint8Array> {
  fontCache.clear()

  // Pre-compute glyph sets for font subsetting
  const glyphMap = collectGlyphsPerFont(pages)

  const pdfDoc = await PDFDocument.load(originalBytes)

  // Register fontkit for custom font support
  try {
    pdfDoc.registerFontkit(fontkit as any)
  } catch {
    // fontkit may fail in some environments, continue with standard fonts
  }

  // Apply page deletions in reverse order to maintain valid indices
  const toRemove: number[] = []
  for (const pageState of pages) {
    if (pageState.deleted) {
      toRemove.push(pageState.pageIndex)
    }
  }
  toRemove.sort((a, b) => b - a)
  for (const idx of toRemove) {
    if (idx >= 0 && idx < pdfDoc.getPageCount()) {
      pdfDoc.removePage(idx)
    }
  }

  const activePages = pages.filter((p: any) => !p.deleted)

  // Apply rotations and page sizes
  for (let i = 0; i < activePages.length; i++) {
    const pageState = activePages[i]
    if (i >= pdfDoc.getPageCount()) break
    const pdfPage = pdfDoc.getPage(i)

    // Apply page size change
    if (pageState.pageSize) {
      pdfPage.setSize(pageState.pageSize.width, pageState.pageSize.height)
    }

    // Apply rotation
    if (pageState.rotation !== 0) {
      const currentRotation = pdfPage.getRotation().angle
      pdfPage.setRotation(degrees(currentRotation + pageState.rotation))
    }
  }

  // ── TextLayer edits (pdfjs TextLayer-based inline editing) ──────
  // Each page may have _textLayerEdits: array of { spanIndex, originalText, newText }.
  // These map directly to content stream text runs by index order.
  for (let i = 0; i < activePages.length; i++) {
    const pageState = activePages[i] as any
    const textEdits = pageState._textLayerEdits
    if (!textEdits || textEdits.length === 0) continue
    if (i >= pdfDoc.getPageCount()) break

    const streamData = getPageContentBytes(pdfDoc, i)
    if (!streamData) continue

    const parsed = parseContentStream(streamData.bytes)
    let modified = false

    for (const edit of textEdits) {
      // Map span index to content stream text run index
      // pdfjs textDivs are in the same order as getTextContent() items,
      // which correspond 1:1 to our parsed textRuns (sequential Tj/TJ ops)
      const run = parsed.textRuns[edit.spanIndex]
      if (!run) continue

      const newBytes = encodeTextToBytes(edit.newText)
      applyTextReplacement(parsed, run.opIndex, newBytes, run.tjElementIndex)
      modified = true
    }

    if (modified) {
      const newBytes = serializeContentStream(parsed.operators, streamData.bytes)
      writePageContentBytes(streamData.stream, newBytes, true)
    }
  }

  // ── Fabric edit_text blocks (legacy overlay approach, kept as fallback) ──
  for (let i = 0; i < activePages.length; i++) {
    const pageState = activePages[i]
    if (!pageState.fabricJSON) continue
    if (i >= pdfDoc.getPageCount()) break

    const fabricData = pageState.fabricJSON as any
    const objects: any[] = fabricData.objects || []
    const editBlocks = objects.filter((obj: any) =>
      obj.__editTextBlock && obj.text !== obj.__originalText
    )
    if (editBlocks.length === 0) continue

    const streamData = getPageContentBytes(pdfDoc, i)
    if (!streamData) continue

    const parsed = parseContentStream(streamData.bytes)

    for (const block of editBlocks) {
      const opIndices: number[] = block.__operatorIndices || []
      const runs = block.__originalTextRuns || []
      if (opIndices.length === 0 || runs.length === 0) continue

      // Try to encode with CMap-aware glyph mapping
      const firstRun = runs[0]
      let encoded: Uint8Array | null = null

      // Check if original was hex-encoded (likely CMap/glyph-indexed)
      if (firstRun.rawString?.type === 'hex' && firstRun.rawString?.value) {
        // Build glyph map from the run's data and try encoding
        // For now, use simple Latin-1 encoding for hex strings
        encoded = encodeTextToBytes(block.text)
      } else {
        encoded = encodeTextToBytes(block.text)
      }

      if (!encoded) continue

      // Apply replacement to each matched operator
      for (let j = 0; j < opIndices.length; j++) {
        const opIdx = opIndices[j]
        const run = runs[j]
        if (!run) continue

        // For multi-run blocks (text split across operators), we put
        // the full edited text in the first operator and clear the rest
        const textForThisOp = j === 0 ? block.text : ''
        const bytes = encodeTextToBytes(textForThisOp)
        if (bytes) {
          applyTextReplacement(parsed, opIdx, bytes, run.tjElementIndex)
        }
      }
    }

    // Serialize and write back
    const newBytes = serializeContentStream(parsed.operators, streamData.bytes)
    writePageContentBytes(streamData.stream, newBytes, true)
  }

  // Apply fabric edits (skip __editTextBlock objects — they're now in the content stream)
  for (let i = 0; i < activePages.length; i++) {
    const pageState = activePages[i]
    if (!pageState.fabricJSON) continue
    if (i >= pdfDoc.getPageCount()) break

    const pdfPage = pdfDoc.getPage(i)
    const { width: pdfW, height: pdfH } = pdfPage.getSize()

    const canvasWidth = pdfW * zoom
    const canvasHeight = pdfH * zoom
    const mapper = createCoordinateMapper(canvasWidth, canvasHeight, pdfW, pdfH)

    const fabricData = pageState.fabricJSON as any
    const objects = fabricData.objects || []

    for (const obj of objects) {
      // Skip edit-text blocks — already handled via content stream replacement
      if (obj.__editTextBlock) continue
      await renderFabricObject(pdfDoc, pdfPage, obj, mapper, glyphMap)
    }
  }

  // Apply form values
  try {
    const form = pdfDoc.getForm()
    for (const pageState of activePages) {
      if (!pageState.formValues) continue
      for (const [fieldName, value] of Object.entries(pageState.formValues)) {
        if (typeof value === 'boolean') {
          try {
            const checkbox = form.getCheckBox(fieldName)
            if (value) checkbox.check()
            else checkbox.uncheck()
          } catch {
            // Field may not be a checkbox
          }
        } else {
          // Try text field first
          try {
            const textField = form.getTextField(fieldName)
            textField.setText(value as string)
          } catch {
            // Try radio group
            try {
              const radioGroup = form.getRadioGroup(fieldName)
              radioGroup.select(value as string)
            } catch {
              // Try dropdown
              try {
                const dropdown = form.getDropdown(fieldName)
                dropdown.select(value as string)
              } catch {
                // Field type not recognized or doesn't exist
              }
            }
          }
        }
      }
    }
  } catch {
    // No form fields in document
  }

  // Apply headers & footers
  if (options?.headerFooter) {
    await renderHeadersFooters(pdfDoc, activePages, options.headerFooter)
  }

  // Save with encryption if requested
  if (options?.encryption) {
    return pdfDoc.save({
      userPassword: options.encryption.userPassword,
      ownerPassword: options.encryption.ownerPassword
    } as any)
  }

  return pdfDoc.save()
}

// ── Render Fabric Objects to PDF ─────────────────────────────────

async function renderFabricObject(
  pdfDoc: PDFDocument,
  page: PDFPage,
  obj: any,
  mapper: ReturnType<typeof createCoordinateMapper>,
  glyphMap: Map<string, string>
): Promise<void> {
  switch (obj.type) {
    case 'textbox':
    case 'i-text':
    case 'text': {
      const text = obj.text || ''
      const fontSize = mapper.sizeToPdf(obj.fontSize || 16)
      const color = hexToRgb(obj.fill || '#000000')
      const customFontId = obj.__customFontId || undefined
      const font = await getFont(
        pdfDoc,
        obj.fontFamily || 'Helvetica',
        obj.fontWeight === 'bold',
        obj.fontStyle === 'italic',
        customFontId,
        customFontId ? glyphMap.get(customFontId) : undefined
      )

      const lines = text.split('\n')
      const lineHeight = obj.lineHeight || 1.2

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]
        if (!line.trim()) continue

        const yOffset =
          (obj.top || 0) +
          (obj.fontSize || 16) * lineIdx * lineHeight +
          (obj.fontSize || 16)
        const pos = mapper.fabricToPdf(obj.left || 0, yOffset)

        page.drawText(line, {
          x: pos.x,
          y: pos.y,
          size: fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
          opacity: obj.opacity ?? 1
        })
      }
      break
    }

    case 'rect': {
      const left = obj.left || 0
      const top = obj.top || 0
      const w = (obj.width || 0) * (obj.scaleX || 1)
      const h = (obj.height || 0) * (obj.scaleY || 1)
      const pos = mapper.fabricToPdf(left, top + h)
      const strokeColor = hexToRgb(obj.stroke || '#000000')
      const hasFill = obj.fill && obj.fill !== 'transparent' && obj.fill !== ''
      const fillColor = hasFill ? hexToRgb(obj.fill) : null

      page.drawRectangle({
        x: pos.x,
        y: pos.y,
        width: mapper.scaleToPdf(w),
        height: mapper.sizeToPdf(h),
        borderColor: obj.stroke ? rgb(strokeColor.r, strokeColor.g, strokeColor.b) : undefined,
        borderWidth: obj.strokeWidth ? mapper.sizeToPdf(obj.strokeWidth) : undefined,
        color: fillColor ? rgb(fillColor.r, fillColor.g, fillColor.b) : undefined,
        opacity: obj.opacity ?? 1
      })
      break
    }

    case 'ellipse': {
      const rx = (obj.rx || 0) * (obj.scaleX || 1)
      const ry = (obj.ry || 0) * (obj.scaleY || 1)
      const cx = (obj.left || 0) + rx
      const cy = (obj.top || 0) + ry
      const center = mapper.fabricToPdf(cx, cy)
      const strokeColor = hexToRgb(obj.stroke || '#000000')
      const hasFill = obj.fill && obj.fill !== 'transparent' && obj.fill !== ''
      const fillColor = hasFill ? hexToRgb(obj.fill) : null

      page.drawEllipse({
        x: center.x,
        y: center.y,
        xScale: mapper.scaleToPdf(rx),
        yScale: mapper.sizeToPdf(ry),
        borderColor: obj.stroke ? rgb(strokeColor.r, strokeColor.g, strokeColor.b) : undefined,
        borderWidth: obj.strokeWidth ? mapper.sizeToPdf(obj.strokeWidth) : undefined,
        color: fillColor ? rgb(fillColor.r, fillColor.g, fillColor.b) : undefined,
        opacity: obj.opacity ?? 1
      })
      break
    }

    case 'line': {
      const x1 = obj.x1 ?? 0
      const y1 = obj.y1 ?? 0
      const x2 = obj.x2 ?? 0
      const y2 = obj.y2 ?? 0
      const left = obj.left || 0
      const top = obj.top || 0
      const w = obj.width || 0
      const h = obj.height || 0

      // Fabric stores line coords relative to the object center
      const start = mapper.fabricToPdf(left + x1 + w / 2, top + y1 + h / 2)
      const end = mapper.fabricToPdf(left + x2 + w / 2, top + y2 + h / 2)
      const strokeColor = hexToRgb(obj.stroke || '#000000')

      page.drawLine({
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        thickness: mapper.sizeToPdf(obj.strokeWidth || 1),
        color: rgb(strokeColor.r, strokeColor.g, strokeColor.b),
        opacity: obj.opacity ?? 1
      })

      // Arrow head
      if (obj.__isArrow) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        const headLen = mapper.sizeToPdf(12)
        const a1 = angle + Math.PI * 0.85
        const a2 = angle - Math.PI * 0.85

        page.drawLine({
          start: { x: end.x, y: end.y },
          end: { x: end.x + headLen * Math.cos(a1), y: end.y + headLen * Math.sin(a1) },
          thickness: mapper.sizeToPdf(obj.strokeWidth || 1),
          color: rgb(strokeColor.r, strokeColor.g, strokeColor.b),
          opacity: obj.opacity ?? 1
        })
        page.drawLine({
          start: { x: end.x, y: end.y },
          end: { x: end.x + headLen * Math.cos(a2), y: end.y + headLen * Math.sin(a2) },
          thickness: mapper.sizeToPdf(obj.strokeWidth || 1),
          color: rgb(strokeColor.r, strokeColor.g, strokeColor.b),
          opacity: obj.opacity ?? 1
        })
      }
      break
    }

    case 'group': {
      // Rasterize groups (stamps, sticky notes) to PNG and embed
      try {
        const left = obj.left || 0
        const top = obj.top || 0
        const w = (obj.width || 100) * (obj.scaleX || 1)
        const h = (obj.height || 100) * (obj.scaleY || 1)

        const offscreen = new OffscreenCanvas(Math.ceil(w) + 4, Math.ceil(h) + 4)
        const ctx = offscreen.getContext('2d')!
        ctx.globalAlpha = obj.opacity ?? 1

        // Render group children
        if (obj.objects) {
          for (const child of obj.objects) {
            renderGroupChild(ctx, child, w, h, obj.scaleX || 1, obj.scaleY || 1)
          }
        }

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const arrayBuf = await blob.arrayBuffer()
        const pngBytes = new Uint8Array(arrayBuf)
        const image = await pdfDoc.embedPng(pngBytes)

        const pos = mapper.fabricToPdf(left, top + h)
        page.drawImage(image, {
          x: pos.x,
          y: pos.y,
          width: mapper.scaleToPdf(w),
          height: mapper.sizeToPdf(h)
        })
      } catch {
        // Skip groups that fail to rasterize
      }
      break
    }

    case 'image': {
      if (!obj.src) break
      try {
        const response = await fetch(obj.src)
        const arrayBuf = await response.arrayBuffer()
        const bytes = new Uint8Array(arrayBuf)

        let image
        if (bytes[0] === 0x89 && bytes[1] === 0x50) {
          image = await pdfDoc.embedPng(bytes)
        } else {
          image = await pdfDoc.embedJpg(bytes)
        }

        const scaleX = obj.scaleX || 1
        const scaleY = obj.scaleY || 1
        const imgWidth = (obj.width || 100) * scaleX
        const imgHeight = (obj.height || 100) * scaleY

        const pos = mapper.fabricToPdf(obj.left || 0, (obj.top || 0) + imgHeight)

        page.drawImage(image, {
          x: pos.x,
          y: pos.y,
          width: mapper.scaleToPdf(imgWidth),
          height: mapper.sizeToPdf(imgHeight)
        })
      } catch {
        // Skip images that can't be embedded
      }
      break
    }

    case 'path': {
      // Freehand drawings: rasterize to transparent PNG
      try {
        const pathData = obj.path
        if (!pathData) break

        const left = obj.left || 0
        const top = obj.top || 0
        const width = obj.width || 100
        const height = obj.height || 100
        const scaleX = obj.scaleX || 1
        const scaleY = obj.scaleY || 1

        const scaledWidth = width * scaleX
        const scaledHeight = height * scaleY

        const offscreen = new OffscreenCanvas(
          Math.ceil(scaledWidth) + 4,
          Math.ceil(scaledHeight) + 4
        )
        const ctx = offscreen.getContext('2d')!

        ctx.strokeStyle = obj.stroke || '#000000'
        ctx.lineWidth = obj.strokeWidth || 1
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = obj.opacity || 1

        ctx.beginPath()
        for (const cmd of pathData) {
          switch (cmd[0]) {
            case 'M':
              ctx.moveTo((cmd[1] - left / scaleX) * scaleX + 2, (cmd[2] - top / scaleY) * scaleY + 2)
              break
            case 'L':
              ctx.lineTo((cmd[1] - left / scaleX) * scaleX + 2, (cmd[2] - top / scaleY) * scaleY + 2)
              break
            case 'Q':
              ctx.quadraticCurveTo(
                (cmd[1] - left / scaleX) * scaleX + 2, (cmd[2] - top / scaleY) * scaleY + 2,
                (cmd[3] - left / scaleX) * scaleX + 2, (cmd[4] - top / scaleY) * scaleY + 2
              )
              break
            case 'C':
              ctx.bezierCurveTo(
                (cmd[1] - left / scaleX) * scaleX + 2, (cmd[2] - top / scaleY) * scaleY + 2,
                (cmd[3] - left / scaleX) * scaleX + 2, (cmd[4] - top / scaleY) * scaleY + 2,
                (cmd[5] - left / scaleX) * scaleX + 2, (cmd[6] - top / scaleY) * scaleY + 2
              )
              break
          }
        }
        ctx.stroke()

        const blob = await offscreen.convertToBlob({ type: 'image/png' })
        const arrayBuf = await blob.arrayBuffer()
        const pngBytes = new Uint8Array(arrayBuf)
        const image = await pdfDoc.embedPng(pngBytes)

        const pos = mapper.fabricToPdf(left, top + scaledHeight)

        page.drawImage(image, {
          x: pos.x,
          y: pos.y,
          width: mapper.scaleToPdf(scaledWidth),
          height: mapper.sizeToPdf(scaledHeight)
        })
      } catch {
        // Skip paths that fail to rasterize
      }
      break
    }
  }
}

// ── Render Group Children (for stamps, sticky notes) ─────────────

function renderGroupChild(
  ctx: OffscreenCanvasRenderingContext2D,
  child: any,
  groupW: number,
  groupH: number,
  groupScaleX: number,
  groupScaleY: number
): void {
  const cx = (child.left || 0) + groupW / 2
  const cy = (child.top || 0) + groupH / 2

  ctx.save()

  if (child.angle) {
    ctx.translate(cx, cy)
    ctx.rotate((child.angle * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }

  if (child.type === 'rect') {
    const w = (child.width || 0) * (child.scaleX || 1)
    const h = (child.height || 0) * (child.scaleY || 1)
    if (child.fill && child.fill !== 'transparent') {
      ctx.fillStyle = child.fill
      ctx.globalAlpha = child.opacity ?? 1
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h)
    }
    if (child.stroke) {
      ctx.strokeStyle = child.stroke
      ctx.lineWidth = child.strokeWidth || 1
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h)
    }
  } else if (child.type === 'textbox' || child.type === 'text') {
    ctx.fillStyle = child.fill || '#000000'
    ctx.font = `${child.fontWeight || 'normal'} ${child.fontStyle || 'normal'} ${child.fontSize || 14}px ${child.fontFamily || 'Helvetica'}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(child.text || '', cx, cy)
  }

  ctx.restore()
}

// ── Headers & Footers ────────────────────────────────────────────

async function renderHeadersFooters(
  pdfDoc: PDFDocument,
  activePages: any[],
  config: HeaderFooterConfig
): Promise<void> {
  const font = await pdfDoc.embedFont(mapToStandardFont(config.fontFamily, false, false))
  const color = hexToRgb(config.color)
  const fontSize = config.fontSize || 10
  const totalPages = activePages.filter((p: any) => !p.deleted).length

  for (let i = 0; i < Math.min(activePages.length, pdfDoc.getPageCount()); i++) {
    // Check apply-to scope
    const pageNum = i + 1
    if (config.applyTo === 'odd' && pageNum % 2 === 0) continue
    if (config.applyTo === 'even' && pageNum % 2 !== 0) continue

    const page = pdfDoc.getPage(i)
    const { width, height } = page.getSize()
    const margin = 40 // left/right margin in points

    const resolveTokens = (text: string): string =>
      text
        .replace(/\{page\}/g, String(pageNum))
        .replace(/\{pages\}/g, String(totalPages))
        .replace(/\{date\}/g, new Date().toLocaleDateString())
        .replace(/\{time\}/g, new Date().toLocaleTimeString())
        .replace(/\{filename\}/g, 'Document')

    const drawZone = (text: string, x: number, y: number, align: 'left' | 'center' | 'right') => {
      if (!text.trim()) return
      const resolved = resolveTokens(text)
      let drawX = x
      if (align === 'center') {
        const textWidth = font.widthOfTextAtSize(resolved, fontSize)
        drawX = x - textWidth / 2
      } else if (align === 'right') {
        const textWidth = font.widthOfTextAtSize(resolved, fontSize)
        drawX = x - textWidth
      }
      page.drawText(resolved, {
        x: drawX,
        y,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b)
      })
    }

    const headerY = height - (config.marginTop || 20)
    const footerY = config.marginBottom || 20

    // Headers
    drawZone(config.headerLeft, margin, headerY, 'left')
    drawZone(config.headerCenter, width / 2, headerY, 'center')
    drawZone(config.headerRight, width - margin, headerY, 'right')

    // Footers
    drawZone(config.footerLeft, margin, footerY, 'left')
    drawZone(config.footerCenter, width / 2, footerY, 'center')
    drawZone(config.footerRight, width - margin, footerY, 'right')
  }
}
