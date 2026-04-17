# Open Satchel — Tauri Roadmap

Rewrite status. Milestone-by-milestone, with verifiable shippable slices.

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

- [ ] MuPDF binding for exotic CMap / RTL / tagged PDF handling
- [ ] OCR via Tesseract WASM or native binding
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
- [ ] Font subsetting at save time — a pure-Rust subset-font equivalent
  (currently pass-through, so imported fonts embed as full files).
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
