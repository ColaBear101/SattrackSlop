import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/* Unit tests for the pure library (src/lib), the runes stores (*.svelte.ts need the Svelte
   plugin to compile) and the Elysia app (server/, exercised with app.handle - no port). The
   browser-driven suites live in verification/ and are not run by Vitest. */
export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 30_000
  }
});
