# Open Satchel — Roadmap

A free, private, no-paywall, no-email editor for documents and other formats
that the corpos lock behind subscriptions.

Repo: https://github.com/JayQuan-McCleary/open-satchel

---

## Currently shipped (April 2026)

**Formats:** PDF (deep), DOCX (full TipTap editor), XLSX (grid), Markdown, CSV, HTML (viewer), images (generic viewer), code/plaintext.

**PDF feature surface:** ~95% WPS parity, large chunk of Acrobat Pro.
- Edit / annotate / draw / shapes / stamps / highlights (4 types)
- Sticky notes / signatures (draw + type) / measure tool
- 7-tab ribbon + Tools + Batch tabs (~60+ buttons)
- Self-signed PKI digital signatures
- True-burn redaction (text unrecoverable)
- PDF ↔ Word / Excel / PPT / TXT / Image conversions
- Metadata editor + strip
- Bookmarks / outline editor
- Compare two PDFs (text diff + side-by-side viewer)
- Form creator (5 field types)
- Page manager (rotate/delete/duplicate/extract/insert/replace + drag-reorder + odd/even filter)
- Auto-scroll, eye-protection, hide-annotations, find/replace, spell check, read aloud
- Custom thumbnail (embed /Thumb + optional cover page)
- Snip & Pin, Batch Print/Rename/Collect

**Total verified end-to-end checks:** ~140+ across all sessions, 0 failures.

---

# 📄 Document formats still to tackle

## Tier 1 — Office parity (critical for "replacement" positioning)

| Format | Why it matters | Complexity vs PDF |
|---|---|---|
| **.rtf** | MS exchange format, still common in legal/gov | 3% |
| **.odt** | LibreOffice native, direct .docx competitor | 8% |
| **.odp** | OpenDocument presentation | 8% |
| **.ods** | OpenDocument spreadsheet | 5% |
| **.pptx** (read/edit) | Currently can only export; reading + slide editor missing | 18% |
| **.doc / .xls / .ppt** (legacy binary) | Corporate archives; painful format; optional pass-through via libreoffice-headless | 12% |

## Tier 2 — Publishing / reading

| Format | Notes | Complexity |
|---|---|---|
| **.epub** | Huge casual-reader audience; zip of HTML chapters | 15% |
| **.mobi / .azw3** | Kindle; DRM makes real-world files iffy | 10% |
| **.djvu** | Scanned academic/archive; djvu.js renders it | 8% |
| **.fb2** | XML-based ebook (Russia-origin, common in translations) | 3% |
| **.tex** | LaTeX source + live KaTeX preview | 5% |

## Tier 3 — Data / dev formats (dev audience will worship you)

| Format | Notes |
|---|---|
| **.json / .json5 / .jsonl** | Tree viewer + validate + jq-style filter |
| **.yaml / .yml** | Validate + optional schema |
| **.toml** | Config editor |
| **.xml / .xhtml** | XPath + schema + format |
| **.sqlite / .db** | Table browser + query editor. `sql.js` makes it trivial |
| **.ipynb** | Cell list (markdown + code). Rendering is easy, executing needs a kernel — skip exec |
| **.log** | Virtualized viewer + regex filter + timestamp parse |
| **.diff / .patch** | Side-by-side (compare infra already built) |
| **.env / .ini / .conf / .properties** | Key-value table editor |

## Tier 4 — Email / messaging

| Format | Notes |
|---|---|
| **.eml** | Standard email; `mailparser` handles |
| **.msg** | Outlook; `msgreader` handles |
| **.mbox** | Multi-email archive |

## Tier 5 — Archives (browse without extract)

| Format | Notes |
|---|---|
| **.zip** | `jszip` — list + open entries |
| **.tar / .tar.gz / .tgz** | `tar-stream` |
| **.7z** | `7zip-min` wasm |
| **.rar** | `unrar-js` (read-only) |
| **.gz / .bz2** | Single-stream decompress then route |

## Tier 6 — Image formats (generic viewer exists; these need special handling)

| Format | Why special |
|---|---|
| **.svg** | Needs XML editor + render pane, not raster viewer |
| **.tiff** | Multi-page; `utif.js` |
| **.heic / .heif** | Apple format; `heic2any` |
| **.gif** | Animation frames + tag editor |
| **.ico** | Multi-resolution bundle |
| **.raw / .cr2 / .nef / .arw** | Camera RAW thumbnails via libraw-wasm |

## Tier 7 — Certs / keys / crypto artifacts (dev inspector)

| Format | Notes |
|---|---|
| **.pem / .crt / .cer / .p12 / .key** | node-forge already installed — basically free |
| **.asc** | PGP keys |
| **.torrent** | Metadata viewer (name, trackers, files, sizes) |

## Tier 8 — Specialized

| Format | Notes |
|---|---|
| **.srt / .vtt / .ass** | Subtitle timing editor |
| **.ttf / .otf / .woff / .woff2** | Font glyph grid + metadata |
| **.rst / .adoc / .org** | Documentation formats with preview |
| **.bib** | BibTeX citation manager |

## ⚫ Don't bother (violates ethos or traps)

- `.ai` / `.sketch` / `.xd` / `.fig` — vendor-locked
- `.dwg` latest — Autodesk actively breaks interop
- Binary legacy Office — prompt to convert first
- Anything DRM'd (most Kindle, iBooks)
- 3D modeling (Blender's job)
- Image/audio/video editors (already-free territory)

---

# 🗂 PDF side — what's actually left

## 🔥 Must-do before calling PDF "v1.0"

| Task | Effort |
|---|---|
| Wire all download buttons to **Electron `dialog.showSaveDialog`** instead of browser downloads | 1 day |
| Wire **CanvasTools that are built but not ribbon-bound**: Form Designer, Rulers/Guides/Grid, Layers panel (all code exists, need ribbon buttons) | half day |
| **Image downsampling on compress** — currently only object-stream savings; real file-size wins need canvas re-encode + re-embed | 1 day |
| **Font embed + subset on save** — `editSerializer.ts` does partial; need subsetting via fontkit to shrink PDFs with custom fonts | 1-2 days |
| **Sidebar thumbnail panel polish** — `PdfSidebar` throws pdfjs worker errors per earlier audit | half day |
| **Undo/redo at page-op level** — `historyStore` only covers Fabric; page delete/duplicate/rotate isn't undoable | 1 day |
| **Drag-reorder pages in the thumbnail sidebar** (exists in Page Manager modal; should also work in the always-visible sidebar) | half day |

## 🟡 High-value features Acrobat users will ask for

| Task | Effort |
|---|---|
| **Edit existing PDF body text with reflow** — Acrobat's crown jewel. Needs text-run extraction, reshape, content-stream rewrite. Nobody free does this well | 1-2 weeks |
| **Replace/resize embedded images in place** | 3-5 days |
| **Flatten all transparency** — for print workflows | 1 day |
| **True table detection** for PDF→Excel (currently text-row heuristics; `tabula`-style ML would help) | 3-4 days |
| **Sanitize hidden info deep** — strip XMP, comments, form data, attachments, JS, hidden layers for privacy | 1 day |
| **PDF printing** via Electron's native print (bypass the browser `window.print`) | 1 day |
| **Snip & Pin full screen capture** (needs Electron `desktopCapturer` — currently in-document only) | 1 day |
| **Batch processing w/ folder walk** — recursive file-system scan (needs Electron APIs) | half day |
| **Visual-diff pixel overlay** for Compare (text-diff already there; add color-coded pixel diff) | 2 days |

## 🟢 Polish / pro-feature territory

| Task | Effort |
|---|---|
| **Accessibility tag tree editor** + reading-order tool + alt-text | 1-2 weeks |
| **PDF/A validation + conversion** | 1 week (integrate veraPDF or similar) |
| **Form JavaScript actions** — field calculations + validation (spec is 300 pages; just implement the common 20%) | 1 week |
| **Action Wizard** — scripted multi-step batch (UI exists in batch dialogs; needs pipeline DSL) | 3-5 days |
| **Multilingual OCR layout preservation** — tesseract gives text; reconstructing table/column structure is its own pass | 3-5 days |
| **Bates ranges** (skip pages, restart at N, etc.) — bates tool exists, needs richer options | half day |
| **OCR result as searchable text layer** in original PDF (currently exports; should also embed invisible text behind raster) | 1 day |
| **Page labels editor UI** (service exists, no UI yet) | 2 hours |
| **Rulers/guides wired to viewer** (built, not wired) | 2 hours |
| **Layers panel docked in ribbon** (built, not docked) | 2 hours |

## ⚫ Skip per anti-corpo ethos

- AI Assistant (paid API)
- Smart translate (paid API)
- Cloud sync / @mentions / shared review (needs server)
- FormsCentral distribution (needs server)
- CA-verified digital signatures — self-signed works; CA costs real money (~$300/yr)
- PDF/X for commercial print (enterprise-niche)
- Preflight Pro (enterprise-niche)
- Certificate-based document encryption (password encryption works; cert adds CA-dependency)
- PDF JavaScript runtime (the full Acrobat JS spec; rarely-actually-used)

---

# 🛣 Suggested execution order

## Session 1 — finish PDF "must-do"

~2 days of work to take PDF from "impressive demo" to "shippable v1.0":

1. Wire Electron save dialog
2. Wire Form Designer / Rulers / Layers to ribbon
3. Image downsampling in compress
4. Sidebar thumbnail polish
5. Page-op undo/redo

## Session 2 — first new format

Pick **.rtf** or **.odt**. Both reuse the existing TipTap editor. ~4 hours per format closes major Office-parity gaps.

## Session 3 — developer gold

Ship **.json/.yaml/.toml tree editor** + **.sqlite browser**. These two alone make dev Twitter notice. ~1 day each.

## Session 4+ — incremental weekends

Everything else on the format tier list is just incremental weekends. Most non-PDF formats are 1-2 days max.

---

## Reference: complexity multiplier

For sanity-checking effort estimates, here's the rough complexity vs PDF (PDF = 100% baseline):

| Format | Effort vs PDF |
|---|---|
| PDF | 100% |
| EPUB | 15% |
| PPTX (full edit) | 20% |
| DOCX (full) | 15% |
| XLSX (full) | 20% |
| SQLite browser | 8% |
| Jupyter (.ipynb, no exec) | 5% |
| RTF / ODT / EML / MSG | 3% |
| JSON / YAML / TOML | 2% |
| Image viewers | 1% |

PDF was the boss fight. Everything after is downhill.

---

*Last updated: April 15, 2026 · Open Satchel · github.com/JayQuan-McCleary/open-satchel*
