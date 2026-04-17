import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Standalone vite config for the ribbon stress-test harness. Runs the PDF
// Ribbon UI in a plain browser using a stubbed window.api.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5179,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, '..')]
    }
  },
  publicDir: resolve(__dirname, '../test-pdfs'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, '../src/renderer'),
    },
  },
  define: {
    // Polyfill Node globals used by some npm packages (@iarna/toml etc.)
    global: 'globalThis',
  },
})
