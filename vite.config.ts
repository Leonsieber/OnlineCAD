import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // The OpenCascade build ships its own wasm loader; pre-bundling it breaks the wasm lookup.
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5173, strictPort: true },
});
