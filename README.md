# Open Satchel

**Free. Local. No email required. No subscriptions.**

A universal file editor aiming for Acrobat-tier PDF editing and Office-tier document fidelity, built on Tauri + Rust for native perf.

## Status

Fresh rewrite. The previous Electron codebase (v1.0, ~93% Acrobat parity across 35+ formats) is archived at [JayQuan-McCleary/open-satchel-electron-archive](https://github.com/JayQuan-McCleary/open-satchel-electron-archive) as reference material for the port.

## v1 scope (10 formats)

PDF, Markdown, DOCX, XLSX, PPTX, Plain text / Code, CSV, JSON, HTML, Image.

See `DEFERRED_FORMATS.md` for the 25 formats postponed from v1.

## Stack

- **Frontend:** React 18 + TypeScript + Zustand + Vite
- **Shell:** Tauri 2 (Rust)
- **PDF engine (M4+):** MuPDF (AGPL, bundled) with PDFium fallback
- **Office engine (M6):** LibreOffice headless sidecar for DOCX/PPTX fidelity
- **Search (M7):** Tantivy full-text index

## Build & dev

```bash
npm install
npm run tauri:dev
```

## License

AGPL-3.0 — see [LICENSE](./LICENSE). Pairs with bundled MuPDF (AGPL) and LibreOffice (MPL).

## Ethos

No subscriptions. No email gate. No cloud sync. No AI API dependencies. All processing local.
