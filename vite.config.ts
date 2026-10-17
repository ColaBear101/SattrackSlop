import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pkg from './package.json';

/* The Earth console. The Moon pages live in public/ and are copied to dist/ as they are.
   `/api` is proxied to the Elysia server (serve.ts, port 3001) in dev and in `vite preview`;
   when nothing answers there the client falls back to the direct fetches the page always made.
   `__APP_VERSION__` is package.json's version, which the report's footer states (src/env.d.ts declares it). */
const api = { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } };

export default defineConfig({
  plugins: [svelte()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: api },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: api },
  worker: { format: 'es' }
});
