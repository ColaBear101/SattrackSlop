import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const manifest: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/fixtures/moon-sha256.json'), 'utf8')
);

/* The Moon pages are out of scope for the rewrite: they must keep working untouched, at the same
   URLs. The fixture holds the hashes of those files as they were on main (4eadd7a). */
describe('the Moon pages and their scripts', () => {
  for (const [file, want] of Object.entries(manifest)) {
    it(`public/${file} is unchanged`, () => {
      expect(sha(path.join(ROOT, 'public', file))).toBe(want);
    });
  }

  const dist = path.join(ROOT, 'dist');
  const built = fs.existsSync(dist);
  for (const [file, want] of Object.entries(manifest)) {
    it.skipIf(!built)(`dist/${file} is unchanged (needs \`npm run build\`)`, () => {
      expect(sha(path.join(dist, file))).toBe(want);
    });
  }
});
