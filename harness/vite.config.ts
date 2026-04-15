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
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, '../src/renderer'),
    },
  },
})
