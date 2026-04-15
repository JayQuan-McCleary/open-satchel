import { PDFDocument } from 'pdf-lib'

export async function mergePdfs(bytesArray: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()

  for (const bytes of bytesArray) {
    const doc = await PDFDocument.load(bytes)
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    pages.forEach((page) => merged.addPage(page))
  }

  return merged.save()
}

export async function splitPdf(
  bytes: Uint8Array,
  ranges: [number, number][]
): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes)
  const results: Uint8Array[] = []

  for (const [start, end] of ranges) {
    const doc = await PDFDocument.create()
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i)
    const pages = await doc.copyPages(source, indices)
    pages.forEach((page) => doc.addPage(page))
    results.push(await doc.save())
  }

  return results
}
