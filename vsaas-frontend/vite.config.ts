import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'

// Preview-mode stub: @sentry/react não instalado localmente.
// Quando o pacote estiver presente em node_modules/, este alias se desativa sozinho.
const STUB_SENTRY = !fs.existsSync(path.resolve(__dirname, 'node_modules/@sentry/react'))

// Cache dir gravável (node_modules pertence a root nesta VPS).
const CACHE_DIR = process.env.VITE_CACHE_DIR || '/tmp/vite-cache-iacloud'

export default defineConfig({
  plugins: [react()],
  cacheDir: CACHE_DIR,
  resolve: {
    alias: STUB_SENTRY
      ? { '@sentry/react': path.resolve(__dirname, 'src/lib/sentry-stub.ts') }
      : {},
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['app.iacloud.com.br'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    sourcemap: 'hidden',
    // Hardening Iteração 1 (docs/13 §10 — perf budget):
    // - chunkSizeWarningLimit warna se algum chunk > 600 kB minified
    // - reportCompressedSize: true → CI loga gzipped sizes para tracking
    chunkSizeWarningLimit: 600,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Hardening Iteração 2 — perf: chunk dedicado pra hls.js.
        // Antes hls.js era bundleado com PlaybackTimelineZoom (524 KB raw /
        // 166 KB gz). Em chunk separado vira async-load só quando entra em
        // /live ou /recordings, e fica em cache HTTP imutável entre as duas.
        manualChunks: STUB_SENTRY
          ? {
              vendor: ['react', 'react-dom', 'react-router-dom'],
              charts: ['recharts'],
              motion: ['framer-motion'],
              utils:  ['date-fns', 'axios', 'swr'],
              hls:    ['hls.js'],
            }
          : {
              vendor: ['react', 'react-dom', 'react-router-dom'],
              charts: ['recharts'],
              motion: ['framer-motion'],
              utils:  ['date-fns', 'axios', 'swr'],
              hls:    ['hls.js'],
              sentry: ['@sentry/react'],
            },
      },
    },
  },
})
