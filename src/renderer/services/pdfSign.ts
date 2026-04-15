// Self-signed PKCS#12 digital signatures. Generates an RSA keypair +
// self-signed X.509 cert client-side, embeds it into a .p12 bundle,
// then signs the PDF with @signpdf/signpdf. Verifies by inspecting
// /Sig fields on the saved PDF.
//
// Note: "self-signed" means viewers like Adobe Reader will show the
// signature as valid but untrusted (no CA chain). True trusted-CA
// signing requires purchasing a cert from a CA.

import forge from 'node-forge'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import signpdf from '@signpdf/signpdf'
import { P12Signer } from '@signpdf/signer-p12'
import { plainAddPlaceholder } from '@signpdf/placeholder-plain'
import { Buffer as BufferPolyfill } from 'buffer'

// Node's Buffer is required by @signpdf; polyfill for browser.
if (typeof globalThis.Buffer === 'undefined') {
  ;(globalThis as unknown as { Buffer: typeof BufferPolyfill }).Buffer = BufferPolyfill
}

export interface CertIdentity {
  commonName: string
  organization?: string
  country?: string
  email?: string
}

export interface GeneratedCert {
  p12: Uint8Array       // PKCS#12 bundle (cert + private key)
  passphrase: string    // used to decrypt the .p12
  certPem: string       // public cert in PEM form (shareable)
}

/** Generate a self-signed keypair + PKCS#12 bundle. Pure client-side;
 *  nothing leaves the browser. Passphrase defaults to a random 16-char
 *  string so the .p12 is safe to store locally. */
export async function generateSelfSignedCert(
  identity: CertIdentity,
  passphrase?: string,
): Promise<GeneratedCert> {
  const pass = passphrase ?? Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('')
  // Generate 2048-bit RSA keypair (synchronous via node-forge).
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5)

  const attrs = [
    { name: 'commonName', value: identity.commonName },
    ...(identity.organization ? [{ name: 'organizationName', value: identity.organization }] : []),
    ...(identity.country ? [{ name: 'countryName', value: identity.country }] : []),
    ...(identity.email ? [{ name: 'emailAddress', value: identity.email }] : []),
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs) // self-signed ⇒ issuer = subject
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true, codeSigning: true, emailProtection: true },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  // Bundle into PKCS#12
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, pass, { algorithm: '3des' })
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
  const p12 = new Uint8Array(p12Der.length)
  for (let i = 0; i < p12Der.length; i++) p12[i] = p12Der.charCodeAt(i)

  return { p12, passphrase: pass, certPem: forge.pki.certificateToPem(cert) }
}

export interface SignOptions {
  reason?: string
  location?: string
  signerName?: string
  contactInfo?: string
}

/** Sign the PDF using a .p12 bundle. Returns signed PDF bytes. */
export async function signPdf(
  bytes: Uint8Array,
  p12: Uint8Array,
  passphrase: string,
  opts: SignOptions = {},
): Promise<Uint8Array> {
  // @signpdf/placeholder-plain needs a traditional xref table; pdf-lib's
  // default save uses object streams which it can't parse. Round-trip
  // through pdf-lib with useObjectStreams:false to normalize the xref.
  const normalized = await (async () => {
    const doc = await PDFDocument.load(bytes)
    return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
  })()
  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer: Buffer.from(normalized),
    reason: opts.reason ?? 'Signed with AFPE',
    location: opts.location ?? 'Local',
    name: opts.signerName ?? 'AFPE User',
    contactInfo: opts.contactInfo ?? '',
    signatureLength: 8192,
  })
  const signer = new P12Signer(Buffer.from(p12), { passphrase })
  const signedBuf = await signpdf.sign(withPlaceholder, signer)
  return new Uint8Array(signedBuf)
}

export interface SignatureInfo {
  fieldName: string
  signerName?: string
  reason?: string
  location?: string
  signedAt?: string
}

/** List signatures present in a PDF. Fast path via AcroForm; fallback
 *  parses byte-level /Sig dictionaries since @signpdf-produced
 *  signatures can be structured in ways pdf-lib's form parser misses. */
export async function listSignatures(bytes: Uint8Array): Promise<SignatureInfo[]> {
  const sigs: SignatureInfo[] = []
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const form = doc.getForm()
    for (const field of form.getFields()) {
      const acroField = field.acroField
      const ft = acroField.dict.lookup(PDFName.of('FT'))
      const ftName = ft && typeof (ft as { toString?: () => string }).toString === 'function' ? (ft as { toString: () => string }).toString() : ''
      if (!ftName.includes('Sig')) continue
      const v = acroField.dict.lookup(PDFName.of('V'))
      if (!(v instanceof PDFDict)) continue
      const reason = v.lookup(PDFName.of('Reason'))?.toString?.().replace(/^\(|\)$/g, '')
      const location = v.lookup(PDFName.of('Location'))?.toString?.().replace(/^\(|\)$/g, '')
      const name = v.lookup(PDFName.of('Name'))?.toString?.().replace(/^\(|\)$/g, '')
      const signedAt = v.lookup(PDFName.of('M'))?.toString?.()
      sigs.push({ fieldName: field.getName(), signerName: name, reason, location, signedAt })
    }
  } catch {
    // fall through to byte-level scan
  }

  if (sigs.length === 0) {
    // Byte-level fallback: /Type /Sig dicts are huge (Contents holds a
    // multi-KB PKCS#7 blob between the metadata keys), so a bounded
    // regex won't capture the whole dict. Count signature occurrences,
    // then harvest the metadata keys (which only appear inside sig
    // dicts in well-formed signed PDFs).
    const text = new TextDecoder('latin1').decode(bytes)
    const sigMarkers = text.match(/\/Type\s*\/Sig\b/g) ?? []
    const grab = (key: string) => {
      const r = new RegExp(`\\/${key}\\s*\\(([^\\)]*)\\)`).exec(text)
      return r ? r[1] : undefined
    }
    const names = [...text.matchAll(/\/Name\s*\(([^)]*)\)/g)].map((m) => m[1])
    const reasons = [...text.matchAll(/\/Reason\s*\(([^)]*)\)/g)].map((m) => m[1])
    const locations = [...text.matchAll(/\/Location\s*\(([^)]*)\)/g)].map((m) => m[1])
    const modDates = [...text.matchAll(/\/M\s*\(([^)]*)\)/g)].map((m) => m[1])
    for (let i = 0; i < sigMarkers.length; i++) {
      sigs.push({
        fieldName: `Signature${i + 1}`,
        signerName: names[i] ?? grab('Name'),
        reason: reasons[i] ?? grab('Reason'),
        location: locations[i] ?? grab('Location'),
        signedAt: modDates[i] ?? grab('M'),
      })
    }
  }
  return sigs
}

/** Import an existing .p12 from disk. Useful if the user already has a
 *  cert from a CA or a trusted colleague. Returns normalized bytes. */
export function importP12FromArrayBuffer(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf)
}
