# Deferred formats (v1.1+)

These formats existed in the archived Electron build but are explicitly out of v1 scope to focus engineering on PDF + Office parity. Rust crates noted for each.

## Tier 1 — easy ports (few days each)

| Format | Rust crate | Notes |
|---|---|---|
| YAML / YML | `serde_yaml` | Trivial; parallel to JSON |
| TOML | `toml` | Trivial |
| XML | `quick-xml` | Needed anyway for OOXML |
| JSONL / NDJSON | `serde_json` line mode | Extend JSON handler |
| INI / .env / .conf | `rust-ini` | Trivial |
| BibTeX | `biblatex` | Trivial |
| LaTeX | custom lexer + `katex-wasm` preview | Medium |
| Log files | built-in + `regex` | Virtualized viewer |
| Diff / patch | `similar` | Already best-in-class |
| Subtitles (SRT / VTT / ASS) | custom parser | Trivial |

## Tier 2 — medium ports

| Format | Rust crate | Notes |
|---|---|---|
| SQLite | `rusqlite` | Easy — fills DB Browser gaps (JSON viewer, BLOB preview, line-wrap SQL editor) |
| Jupyter (.ipynb) | `serde_json` + custom cell UI | Read-only, no kernel |
| Archives (zip / tar / 7z / rar / gz) | `zip`, `tar`, `sevenz-rust`, `unrar` | List + extract + open entry |
| Email (.eml / .mbox) | `mail-parser` | Trivial |
| Email (.msg) | `oledecode` equivalent | Harder — binary Outlook format |
| Certificates (.pem / .crt / .p12) | `openssl` / `rustls-pemfile` | Trivial |
| Fonts (.ttf / .otf / .woff / .woff2) | `ttf-parser`, `woff-rs` | Glyph grid |
| RTF | `rtf-parser` crate exists | Medium |
| FB2 | XML-based | Trivial |
| EPUB | `epub-rs` | Zip + HTML |
| SVG | `resvg` | Render + XML edit |
| TIFF multi-page | `image` crate | Built-in |
| HEIC / HEIF | `libheif-rs` (AGPL) or `heic-decoder` | Bundled binary |

## Tier 3 — specialized

| Format | Engine |
|---|---|
| MOBI / AZW3 | `mobi-rs` — read-only metadata + text |
| DjVu | `djvu.js` via WebView subprocess — niche |
| Raw camera (.cr2 / .nef / .arw) | `libraw` FFI |
| `.torrent` | `lava_torrent` — metadata only |
| `.rst` / `.adoc` / `.org` | Pandoc subprocess |
| ICO multi-resolution | `ico` crate |
| GIF animation editor | `image` + custom UI |

## Tier 4 — possibly skip forever

| Format | Reason |
|---|---|
| `.ai`, `.sketch`, `.xd`, `.fig` | Vendor-locked |
| `.dwg` | Autodesk actively breaks interop |
| Binary legacy Office (.doc / .xls / .ppt) | Pass-through via LibreOffice headless — no dedicated handler needed |
| DRM-protected anything (iBooks, Kindle DRM) | Ethics + DMCA |

---

Priority order for post-v1 releases: SQLite → Archives → JSON/YAML/TOML/XML → Subtitles → Email → everything else.
