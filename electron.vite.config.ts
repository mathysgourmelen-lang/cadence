import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict Content Security Policy for the packaged app (dev needs inline scripts for hot reload).
const csp: Plugin = {
  name: 'cadence-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: cadence-media:",
      "media-src 'self' blob: cadence-media:",
      "font-src 'self' data:",
      "connect-src 'self' cadence-media:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'"
    ].join('; ')
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
  }
}

export default defineConfig({
  main: {
    build: { outDir: 'out/main' }
  },
  preload: {
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src/renderer',
    build: { outDir: 'out/renderer', rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react(), csp]
  }
})
