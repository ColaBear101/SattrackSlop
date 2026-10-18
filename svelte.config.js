import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/* discloseVersion: false leaves out the line that adds Svelte's major version to window.__svelte, which nothing reads: about 45 bytes
   gzipped of the entry, whose 90 KB budget binds (verify-visitor.js). */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true, discloseVersion: false }
};
