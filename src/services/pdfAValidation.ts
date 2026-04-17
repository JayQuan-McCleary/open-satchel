// PDF/A Validation — check conformance against archival profiles.
// Implements a subset of PDF/A-1b checks (the 80% case). Not a full
// veraPDF replacement — covers the most common compliance issues.

import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  page?: number
  remediation?: string
}

export interface ValidationResult {
  isCompliant: boolean
  profile: string
  issues: ValidationIssue[]
  score: number  // 0-100
}

/** Validate a PDF against PDF/A-1b profile (basic conformance) */
export async function validatePdfA(bytes: Uint8Array): Promise<ValidationResult> {
  const doc = await PDFDocument.load(bytes)
  const catalog = doc.catalog
  const issues: ValidationIssue[] = []

  // Check 1: Document must have a title (metadata)
  const title = doc.getTitle()
  if (!title || title.trim() === '') {
    issues.push({
      severity: 'error', code: 'PDFA-1',
      message: 'Document has no title in metadata',
      remediation: 'Set document title in Metadata section'
    })
  }

  // Check 2: No JavaScript
  const hasOpenAction = !!catalog.get(PDFName.of('OpenAction'))
  const hasAA = !!catalog.get(PDFName.of('AA'))
  const names = catalog.get(PDFName.of('Names'))
  const namesDict = names ? doc.context.lookup(names) as PDFDict | undefined : undefined
  const hasJSNames = !!namesDict?.get(PDFName.of('JavaScript'))

  if (hasOpenAction || hasAA || hasJSNames) {
    issues.push({
      severity: 'error', code: 'PDFA-2',
      message: 'Document contains JavaScript or actions (forbidden in PDF/A)',
      remediation: 'Use Deep Sanitize to strip JavaScript and actions'
    })
  }

  // Check 3: No encryption
  // pdf-lib loads encrypted docs but we can check the trailer
  try {
    const trailer = (doc as any).context?.trailerInfo
    if (trailer?.Encrypt) {
      issues.push({
        severity: 'error', code: 'PDFA-3',
        message: 'Document is encrypted (forbidden in PDF/A)',
        remediation: 'Remove encryption before archiving'
      })
    }
  } catch { /* ignore */ }

  // Check 4: No embedded files
  const hasAttachments = !!namesDict?.get(PDFName.of('EmbeddedFiles'))
  if (hasAttachments) {
    issues.push({
      severity: 'error', code: 'PDFA-4',
      message: 'Document has embedded file attachments (forbidden in PDF/A-1)',
      remediation: 'Use Deep Sanitize to strip attachments'
    })
  }

  // Check 5: No optional content (layers)
  if (catalog.get(PDFName.of('OCProperties'))) {
    issues.push({
      severity: 'warning', code: 'PDFA-5',
      message: 'Document has optional content groups (layers)',
      remediation: 'Use Deep Sanitize to strip hidden layers'
    })
  }

  // Check 6: Check for XMP metadata stream (required for PDF/A)
  const hasXmp = !!catalog.get(PDFName.of('Metadata'))
  if (!hasXmp) {
    issues.push({
      severity: 'warning', code: 'PDFA-6',
      message: 'No XMP metadata stream (recommended for PDF/A)',
      remediation: 'XMP metadata is auto-generated on save by most tools'
    })
  }

  // Check 7: Font embedding (check if any pages reference non-embedded fonts)
  // This is a simplified check — full validation requires walking font dictionaries
  let fontWarning = false
  for (let i = 0; i < Math.min(doc.getPageCount(), 10); i++) {
    const page = doc.getPage(i)
    const resources = page.node.get(PDFName.of('Resources'))
    if (!resources) continue
    const resDict = doc.context.lookup(resources) as PDFDict | undefined
    if (!resDict) continue
    const fonts = resDict.get(PDFName.of('Font'))
    if (!fonts) continue
    const fontDict = doc.context.lookup(fonts) as PDFDict | undefined
    if (!fontDict) continue

    for (const [_name, ref] of fontDict.entries()) {
      const font = doc.context.lookup(ref) as PDFDict | undefined
      if (!font) continue
      const descriptor = font.get(PDFName.of('FontDescriptor'))
      if (!descriptor) {
        // Standard 14 fonts may not have descriptors — check if it's a standard font
        const baseFont = font.get(PDFName.of('BaseFont'))?.toString() ?? ''
        const standardFonts = ['Helvetica', 'Times', 'Courier', 'Symbol', 'ZapfDingbats']
        const isStandard = standardFonts.some(sf => baseFont.includes(sf))
        if (!isStandard && !fontWarning) {
          fontWarning = true
          issues.push({
            severity: 'warning', code: 'PDFA-7',
            message: 'Some fonts may not be fully embedded',
            remediation: 'Ensure all fonts are embedded (save with font subsetting enabled)'
          })
        }
      }
    }
  }

  // Check 8: Transparency (check for /Group with /S /Transparency on pages)
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const group = page.node.get(PDFName.of('Group'))
    if (group) {
      const groupDict = doc.context.lookup(group) as PDFDict | undefined
      if (groupDict?.get(PDFName.of('S'))?.toString() === '/Transparency') {
        issues.push({
          severity: 'warning', code: 'PDFA-8',
          message: `Page ${i + 1} uses transparency (may need flattening for PDF/A-1)`,
          page: i,
          remediation: 'Use Flatten Transparency before archiving'
        })
        break // Only report once
      }
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const totalChecks = 8
  const passedChecks = totalChecks - errorCount - warningCount * 0.5
  const score = Math.max(0, Math.round((passedChecks / totalChecks) * 100))

  return {
    isCompliant: errorCount === 0,
    profile: 'PDF/A-1b (Basic)',
    issues,
    score,
  }
}
