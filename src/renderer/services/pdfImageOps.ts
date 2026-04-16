// PDF Image Operations — list, replace, and resize embedded images
//
// Walks the /Resources /XObject dictionary to find embedded images,
// provides metadata, and supports in-place replacement/resize.

import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict } from 'pdf-lib'

export interface EmbeddedImage {
  pageIndex: number
  refKey: string         // indirect object key (for replacement)
  width: number
  height: number
  bitsPerComponent: number
  filter: string         // e.g. "DCTDecode" (JPEG), "FlateDecode" (PNG-like)
  colorSpace: string
  byteLength: number
  xObjectName: string    // e.g. "Im0", "Image1"
}

/** List all embedded images across all pages */
export async function listEmbeddedImages(bytes: Uint8Array): Promise<EmbeddedImage[]> {
  const doc = await PDFDocument.load(bytes)
  const images: EmbeddedImage[] = []

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const resources = page.node.get(PDFName.of('Resources'))
    if (!resources) continue
    const resDict = doc.context.lookup(resources) as PDFDict | undefined
    if (!resDict) continue
    const xobjects = resDict.get(PDFName.of('XObject'))
    if (!xobjects) continue
    const xoDict = doc.context.lookup(xobjects) as PDFDict | undefined
    if (!xoDict) continue

    // Iterate XObject entries
    const entries = xoDict.entries()
    for (const [name, ref] of entries) {
      const obj = doc.context.lookup(ref)
      if (!obj || !('dict' in obj)) continue
      const stream = obj as PDFRawStream
      const dict = stream.dict
      const subtype = dict.get(PDFName.of('Subtype'))
      if (!subtype || subtype.toString() !== '/Image') continue

      const w = (dict.get(PDFName.of('Width')) as PDFNumber | undefined)?.asNumber() ?? 0
      const h = (dict.get(PDFName.of('Height')) as PDFNumber | undefined)?.asNumber() ?? 0
      const bpc = (dict.get(PDFName.of('BitsPerComponent')) as PDFNumber | undefined)?.asNumber() ?? 8
      const filter = dict.get(PDFName.of('Filter'))?.toString() ?? 'None'
      const cs = dict.get(PDFName.of('ColorSpace'))?.toString() ?? 'Unknown'

      images.push({
        pageIndex: i,
        refKey: ref.toString(),
        width: w,
        height: h,
        bitsPerComponent: bpc,
        filter: filter.replace('/', ''),
        colorSpace: cs.replace('/', ''),
        byteLength: stream.getContents().byteLength,
        xObjectName: name.toString().replace('/', ''),
      })
    }
  }

  return images
}

/** Replace an embedded image with new JPEG bytes. Updates dimensions and stream. */
export async function replaceEmbeddedImage(
  bytes: Uint8Array,
  pageIndex: number,
  xObjectName: string,
  newImageBytes: Uint8Array,
  newWidth: number,
  newHeight: number
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(pageIndex)
  const resources = page.node.get(PDFName.of('Resources'))
  if (!resources) throw new Error('Page has no resources')
  const resDict = doc.context.lookup(resources) as PDFDict
  const xobjects = resDict.get(PDFName.of('XObject'))
  if (!xobjects) throw new Error('Page has no XObjects')
  const xoDict = doc.context.lookup(xobjects) as PDFDict

  const ref = xoDict.get(PDFName.of(xObjectName))
  if (!ref) throw new Error(`XObject "${xObjectName}" not found`)
  const stream = doc.context.lookup(ref) as PDFRawStream
  const dict = stream.dict

  // Detect if new image is JPEG (starts with FF D8)
  const isJpeg = newImageBytes[0] === 0xFF && newImageBytes[1] === 0xD8

  // Update stream contents
  stream.contents = newImageBytes
  dict.set(PDFName.of('Width'), PDFNumber.of(newWidth))
  dict.set(PDFName.of('Height'), PDFNumber.of(newHeight))
  dict.set(PDFName.of('Length'), PDFNumber.of(newImageBytes.byteLength))

  if (isJpeg) {
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
    dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
  }

  return await doc.save()
}

/** Resize an embedded image by re-encoding it at new dimensions */
export async function resizeEmbeddedImage(
  bytes: Uint8Array,
  pageIndex: number,
  xObjectName: string,
  targetWidth: number,
  targetHeight: number,
  quality: number = 0.8
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(pageIndex)
  const resources = page.node.get(PDFName.of('Resources'))
  if (!resources) throw new Error('Page has no resources')
  const resDict = doc.context.lookup(resources) as PDFDict
  const xobjects = resDict.get(PDFName.of('XObject'))
  if (!xobjects) throw new Error('Page has no XObjects')
  const xoDict = doc.context.lookup(xobjects) as PDFDict

  const ref = xoDict.get(PDFName.of(xObjectName))
  if (!ref) throw new Error(`XObject "${xObjectName}" not found`)
  const stream = doc.context.lookup(ref) as PDFRawStream
  const dict = stream.dict
  const filter = dict.get(PDFName.of('Filter'))?.toString() ?? ''

  // Only JPEG images can be easily resized via canvas
  if (!filter.includes('DCTDecode')) {
    throw new Error('Only JPEG images can be resized (filter: ' + filter + ')')
  }

  const originalBytes = stream.getContents()
  const bitmap = await createImageBitmap(new Blob([originalBytes], { type: 'image/jpeg' }))

  const canvas = new OffscreenCanvas(targetWidth, targetHeight)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  const newBytes = new Uint8Array(await blob.arrayBuffer())

  stream.contents = newBytes
  dict.set(PDFName.of('Width'), PDFNumber.of(targetWidth))
  dict.set(PDFName.of('Height'), PDFNumber.of(targetHeight))
  dict.set(PDFName.of('Length'), PDFNumber.of(newBytes.byteLength))

  return await doc.save()
}
