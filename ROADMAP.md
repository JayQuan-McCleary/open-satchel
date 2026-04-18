# Open Satchel — Tauri Roadmap

Rewrite status. Milestone-by-milestone, with verifiable shippable slices.

---

## Current parity vs Acrobat Pro — snapshot 2026-04-18

Point-in-time honest estimate of where we stand against Acrobat Pro
on the PDF side. Target for v1 is **90-95%** in every "daily-use"
row. The "full surface" table tracks the Acrobat features we *could*
reach eventually (everything not in the "Explicitly out of scope"
section at the bottom of this file); they're lower priority than
nailing the top ~10 things real users touch every day.

### What real users do every day — ~75-80% today

| Area | Was | Now | Acrobat delta (to close) |
|---|---|---|---|
| View / navigate / search | 90% | 90% | bookmarks editor, thumbnails drag UX |
| Paragraph text editing | 55% | 85% | image move, font subsetter (CJK), proper resize handles |
| Annotations (highlight / shape / sticky / stamp) | 75% | 80% | richer stamp library, comment threads |
| Sign (self-signed) | 75% | 75% | certified signatures, timestamp authority |
| Fill forms | 65% | 65% | better auto-detect, JS calc fields (JS is OUT of scope — see bottom) |
| Basic page ops (rotate / delete / reorder / merge / split) | 75% | 75% | — |
| Undo/redo | 70% | 90% | — |

The paragraph-editing row jumped this session — content-stream color
extraction, surgical byte-patch save, modeless layer architecture,
cross-page activeId fix. What was brittle is now genuinely solid.

### Full Acrobat Pro surface — ~45-55% today

| Area | Status |
|---|---|
| Image editing (move / resize / replace in content stream) | 0% |
| Font subsetter for CJK / RTL save | broken — embeds full 11 MB fonts |
| Export to Word / Excel / PowerPoint | 0% |
| PDF/A validation + conversion | 0% |
| Accessibility (tags, alt-text, reading order) | 0% |
| Redaction true-burn | uncertain — needs audit |
| Preflight | 0% (and see Out-of-scope section) |
| Certify / permissions / stronger encryption | partial |
| OCR | exists (Tesseract) — quality unknown |
| Batch operations | exists — coverage thin |

Three specific blockers masquerading as "close enough":

1. **Font subsetter for CJK/Arabic.** Edit one Chinese character, save
   a 100 KB PDF, get 11 MB back. Unshippable for international users.
   ROADMAP M3.5 (below) has the full writeup.
2. **Image move.** Common-case need; still 0%.
3. **Redaction true-burn audit.** If redact paints over text without
   removing it from the content stream, redacted docs aren't really
   redacted. Needs verification before any user claim of redaction.

---

## M1 — Scaffold + PDF viewer ✅ THIS COMMIT

Deliverable: Tauri 2 app that launches, opens a file dialog, loads a PDF, and renders all pages via pdfjs-dist in the WebView.

- [x] Vite + React + TS frontend scaffold
- [x] Rust backend scaffold with tauri-plugin-dialog, tauri-plugin-fs, tauri-plugin-shell
- [x] Tauri IPC commands: `open_file_dialog`, `open_file_path`, `save_file`, `save_file_dialog`, `pick_folder`, `hash_file`, `recent_*`, `pdf_*` (stubs), `app_version`
- [x] Zustand stores: tab, format, UI, history
- [x] Format registry pattern + `DocumentFormat` taxonomy (10 formats declared, PDF implemented)
- [x] App shell: Toolbar, TabBar, ContentRouter, StatusBar, EmptyState
- [x] PDF handler: load via pdfjs, scrollable viewer, thumbnail sidebar
- [x] Keyboard shortcuts: Ctrl+O, Ctrl+S, Ctrl+Shift+S, Ctrl+W, Ctrl+B, Ctrl+F, Ctrl+H, Ctrl+K, Ctrl+Tab
- [x] Recent files (persisted as JSON in app config dir)

**Verification checklist:**
1. `npm run tauri:dev` launches without errors
2. App window opens with Open Satchel empty state
3. "Open file" button triggers native file dialog
4. Selecting a PDF loads it, all pages render, thumbnails populate sidebar
5. Close tab works, reopens work, recent files persist across restart

---

## M2 — PDF parity pass 1 (viewer polish)

- [ ] Swap frontend pdfjs render for native `pdfium-render` in Rust via new `pdf_render_page` impl
  - Keep pdfjs fallback for text layer + search
- [ ] Text layer (selection + copy) via pdfjs text extraction
- [ ] Find/Replace panel wired into PDF search
- [ ] Zoom controls (fit-width, fit-page, custom %)
- [ ] Keyboard page navigation (arrows, Home/End, PgUp/PgDn)
- [ ] Undo/redo plumbing on historyStore
- [ ] Save-to-disk works with in-memory edits (no edits yet, just plumbing)

## M3 — PDF parity pass 2 (editor)

- [ ] Fabric canvas annotation layer (rect, circle, freehand, text, highlight)
- [ ] Content-stream text editing port from Electron-era `contentStreamParser.ts`
- [ ] Page manager: rotate, delete, duplicate, extract, insert, replace, drag-reorder
- [ ] Bookmarks / outline editor
- [ ] Compare two PDFs (text diff + side-by-side viewer)
- [ ] Form creator (5 field types)
- [ ] Redaction (true-burn text removal)
- [ ] Self-signed PKI digital signatures (RSA via node-forge equivalent in Rust: `rsa` + `pkcs8` crates)

## M4 — PDF parity pass 3 (Acrobat-tier)

- [ ] **MuPDF binding for exotic CMap / RTL / tagged PDF handling.**
  License decision (pre-Tauri era, preserved here): MuPDF is AGPL or
  ~$2k/yr commercial. We chose **AGPL** because Open Satchel is
  local-only — the AGPL network-distribution clause never triggers
  in practice, so there's zero downstream cost. Alternatives considered:
  - **Poppler** (GPL) — infects source same as AGPL, no commercial
    option, smaller feature surface.
  - **PDFium** (BSD, render-only) — no edit capability. Would be a
    fallback renderer only; still need pdfjs for text layer + search.
  Current state: PDF rendering goes through pdfjs-dist in the WebView.
  MuPDF is NOT wired yet. Bind when we hit an exotic PDF that pdfjs
  can't handle (CMap fonts with custom encodings, tagged PDFs with
  deep structure trees, complex RTL shaping edge cases).
- [ ] **OCR via Tesseract WASM or native binding.** Chose tesseract.js
  (current dep) over paid cloud services (Google Cloud Vision, AWS
  Textract, Abbyy Cloud, Azure Form Recognizer — all ~$1-5k/yr for
  moderate throughput) to preserve the local-first, no-network
  commitment. Cloud OCR gives ~15-30% accuracy improvement on low-res
  scans and multi-column layouts; revisit only if user demand for
  scan accuracy outweighs the no-network promise. Not an Out-of-scope
  item — just a deferred quality upgrade with a clear trade-off.
- [ ] Image replacement in content stream
- [ ] Transparency flattening
- [ ] PDF/A validation + conversion
- [ ] Accessibility tag tree editor + alt-text + reading-order tool
- [ ] Metadata deep strip (XMP, JS, embedded files, hidden layers)

## M5 — Formats 2–7

- [ ] Markdown (live split preview via `pulldown-cmark`)
- [ ] Code / plaintext (CodeMirror 6 with tree-sitter syntax)
- [ ] CSV / TSV (sheet grid via `calamine` read path for consistency)
- [ ] JSON family (tree viewer + schema validate + jq-style filter)
- [ ] HTML (render + source toggle)
- [ ] Image (EXIF metadata panel, rotate, crop)

## M6 — Office

- [ ] DOCX: `docx-rs` read/write + LibreOffice headless sidecar for fidelity rendering
- [ ] XLSX: `calamine` read + `rust_xlsxwriter` write + sheet grid
- [ ] PPTX: raw OOXML parse + LibreOffice sidecar for slide rendering
- [ ] Bundling strategy for LibreOffice (portable detect: %USERPROFILE%\.open-satchel\libreoffice or bundled)

## M3.5 — Paragraph editor polish (from live-user feedback)

- [ ] **Linked paragraph blocks** — Shift-click two or more paragraph bboxes
  to chain them; typing in one reflows across the chain (Foxit's
  differentiator, the feature Acrobat users wish Acrobat had). Requires
  a `ParagraphChain` model that tracks ordered membership + a custom
  text-flow algorithm that spills overflow into the next bbox.
- [ ] Font-aware paragraph editing — prefer the original embedded font
  when available via `font.scanPdf` + `font.getBytes`. Falls back to
  user-picked system font otherwise.
- [ ] **Font subsetting at save time — CRITICAL, do NOT use pd-lib's
  built-in subsetter for complex scripts.** Confirmed 2026-04-18 via
  the stress-test fixture (`scripts/gen-stress-pdf.mjs`, page 3):
  passing `{ subset: true }` to pd-lib's `embedFont` for Noto Sans SC
  produces a PDF where Chinese text renders as sparse, wrong glyphs
  ("这是一段中文测试" comes out "版 界 。 同 。 言"), and for Amiri
  Arabic the shaped output is empty. Root cause: pd-lib's subsetter
  rebuilds the cmap and layout tables naively — it drops glyphs from
  dense CJK cmaps even when they're drawn, and for complex scripts it
  mangles the GSUB/GPOS/morx tables that drive contextual shaping, so
  Arabic letters never connect. For the stress fixture we work around
  this with per-font `subset:false`, which bloats PDF size from ~100 KB
  to ~11 MB (NotoSansSC alone is 17 MB uncompressed). This is NOT
  acceptable for shipped save output: users will end up with
  multi-megabyte PDFs after a one-word edit if we hit the same code
  path. Replacement must be a pure-Rust subsetter that:
    1. Respects the font's full cmap (no silent glyph drop)
    2. Preserves GSUB/GPOS/morx for complex scripts
    3. Subsets ALL used glyphs including contextual variants
       (initial/medial/final forms for Arabic, kerning pairs, etc.)
    4. Falls back to embed-whole for fonts whose subset would break
  Candidate crates: `subsetter`, `harfbuzz_rs` (binds to hb-subset —
  already battle-tested, used by Chrome/Android), or `skrifa`. Our
  Rust side already has ttf-parser for scanning; adding hb-subset is
  the most honest path to correct subsetting. Until this ships, the
  save pipeline must either (a) embed whole for non-Latin scripts or
  (b) only embed standard Latin subsets where pd-lib happens to work.
- [ ] Box resize handles on active paragraph — Acrobat-style circular
  grips at corners + edge midpoints.

## M7 — Cross-cutting multiplier features

- [ ] Full-text search across all open tabs (via Tantivy index keyed on tabId)
- [ ] Full-text search across folder (leverages existing `pick_folder` IPC)
- [ ] Split view: secondary pane already threaded through stores (`secondaryTabId`)
- [ ] Format-aware diff (`FormatHandler.diff()` optional method + rules per format)
- [ ] Quick Look hover preview in recent files / search results

## M8 — Windows polish & ship

- [ ] COM Word shell-out for 100% fidelity when Office is installed
- [ ] Native print dialog via `webContents.print` (Tauri plugin)
- [ ] File associations (install-time registry writes)
- [ ] Start Menu / shell integration
- [ ] Real logo + polished icon set (replace `gen-icons.ps1` placeholders)
- [ ] Installer: NSIS or MSI via `tauri build`
- [ ] Auto-update plumbing (local-only signing key, no server — manual "check for updates" reaches GitHub Releases)

---

## Post-v1 (see DEFERRED_FORMATS.md for format queue)

- v1.1: SQLite browser + Archives (zip/tar/7z/rar)
- v1.2: Email (eml/mbox), YAML/TOML/XML, Subtitles
- v1.3: Everything else

---

## Explicitly out of scope (won't build)

Features Acrobat Pro has that Open Satchel deliberately isn't chasing.
Documented here so future contributors (and future-me) don't
re-litigate every six months.

- **Rich media (embedded audio/video playback).** Historical security
  liability — the single biggest PDF malware vector of 2007-2013.
  Adobe themselves deprecated Flash support in 2020 and most
  enterprises disable rich media in their readers. Near-zero user
  demand; competitors (Xodo, PDFgear, Apple Preview, Foxit consumer)
  all skip it and nobody notices.
- **3D models (U3D / PRC).** Format specs haven't been updated since
  2007 (U3D) and PRC is licensed. No maintained open-source renderer
  exists. Audience is a niche of aerospace / automotive / medical-
  training document producers who have dedicated tooling already.
- **CAD layer navigation.** Different product category. Users doing
  real CAD work use AutoCAD / Solidworks / Fusion 360; a PDF editor
  that half-implements CAD would be a worse AutoCAD, not a better
  PDF editor.
- **PostScript rendering / print production (ICC, ink simulation,
  trap, overprint preview).** Professional print-shop concerns.
  Adobe and Enfocus own this market; the audience pays five figures
  for dedicated preflight tools.
- **Preflight profiles + PDF/X validation.** Same reasoning as above
  — print production is a separate industry.
- **Acrobat-style JavaScript automation in forms.** Form calculation
  JS is a security surface and almost always a sign that the workflow
  should live in a real app, not a PDF. Basic form fields (text,
  checkbox, radio, dropdown, signature) are in scope; JS is not.

If a user says "I need PDF editor that does X" where X is on this
list, the honest answer is "use Acrobat Pro for this one" — we're
not trying to be everything Acrobat is, we're trying to be better
at the 80% of PDF work real people do.
