import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api is the indexer server (INDEXER_URL, default http://localhost:8790).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5180,
    // Isolating the page (COOP/COEP) lets the in-browser runtime use several threads.
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    proxy: { '/api': { target: process.env.INDEXER_URL ?? 'http://localhost:8790', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  build: { outDir: '../dist/site', emptyOutDir: true },
});
