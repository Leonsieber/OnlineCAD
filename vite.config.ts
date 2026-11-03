/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Installable app that works offline. The 22 MB OpenCascade wasm is cached on first use
    // instead of at install, so installing stays quick.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'OnlineCAD',
        short_name: 'OnlineCAD',
        description: 'Parametric 3D CAD in your browser: sketch, extrude, sculpt, and print.',
        theme_color: '#0d0f13',
        background_color: '#0d0f13',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [{ action: '/', accept: { 'application/json': ['.ocad'], 'model/stl': ['.stl'], 'model/step': ['.step', '.stp'] } }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'onlinecad-wasm', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  // The OpenCascade build ships its own wasm loader; pre-bundling it breaks the wasm lookup.
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
