import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/* The Earth console. The Moon pages live in public/ and are copied to dist/ as they are.
   `/api` is proxied to the Elysia server (serve.ts, port 3001) in dev and in `vite preview`;
   when nothing answers there the client falls back to the direct fetches the page always made. */
const api = { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } };

export default defineConfig({
  plugins: [svelte()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: api },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: api },
  worker: { format: 'es' }
});
