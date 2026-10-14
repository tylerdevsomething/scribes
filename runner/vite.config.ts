import { defineConfig } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Serves rebuilt files (by sha256) from .cache/files, standing in for the indexer's file cache.
// The runner checks every file's hash against the on-chain manifest, so the cache is not trusted.
const files = resolve(__dirname, '../.cache/files');

export default defineConfig({
  root: __dirname,
  server: {
    port: 5175,
    // Isolating the page (COOP/COEP) lets the runtime use several threads.
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  plugins: [{
    name: 'scribe-files',
    configureServer(server) {
      server.middlewares.use('/files/', (req, res, next) => {
        const sha = (req.url ?? '').replace(/^\//, '');
        const path = join(files, sha);
        if (!/^[0-9a-f]{64}$/.test(sha) || !existsSync(path)) return next();
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('cross-origin-resource-policy', 'same-site');
        createReadStream(path).pipe(res);
      });
    },
  }],
});
