import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Vite config tuned for Tauri 2.x dev loop.
// - fixed port (Tauri reads it from tauri.conf.json -> devUrl)
// - ignore src-tauri changes so HMR doesn't thrash during Rust rebuilds
// - conditional build target per OS (Tauri uses Edge WebView2 on Windows,
//   WebKit on macOS/Linux)
const host = process.env.TAURI_DEV_HOST

/**
 * Serve test fixtures from the repo-root `test-pdfs/` directory at
 * `/test-pdfs/<name>`. Lets us drive the browser-mode shim's
 * openPath(/test-pdfs/foo.pdf) against real files during zenlink /
 * Playwright / manual testing without copying the whole folder into
 * `public/` (the fixtures also feed other tooling and shouldn't move).
 *
 * Only mounted in dev — production builds don't ship test PDFs.
 */
function serveTestPdfs(): Plugin {
  return {
    name: 'open-satchel:serve-test-pdfs',
    apply: 'serve',
    configureServer(server) {
      const mount = '/test-pdfs/'
      const root = path.resolve(server.config.root, 'test-pdfs')
      const files = path.resolve(server.config.root, 'test-files')
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()
        const urlPath = req.url.split('?')[0]
        let base: string | null = null
        let sub: string | null = null
        if (urlPath.startsWith(mount)) {
          base = root
          sub = decodeURIComponent(urlPath.slice(mount.length))
        } else if (urlPath.startsWith('/test-files/')) {
          base = files
          sub = decodeURIComponent(urlPath.slice('/test-files/'.length))
        }
        if (!base || !sub) return next()
        const target = path.join(base, sub)
        // Prevent path traversal outside the mount root.
        if (!target.startsWith(base)) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        fs.stat(target, (err, stat) => {
          if (err || !stat.isFile()) return next()
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', String(stat.size))
          fs.createReadStream(target).pipe(res)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveTestPdfs()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows'
        ? 'chrome105'
        : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
})
