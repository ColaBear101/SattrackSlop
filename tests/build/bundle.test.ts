import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const dist = path.join(ROOT, 'dist');
const built = fs.existsSync(path.join(dist, 'index.html'));

/* Needs `npm run build`. What a visitor downloads must not contain the test surface. */
describe.skipIf(!built)('the production bundle', () => {
  const html = built ? fs.readFileSync(path.join(dist, 'index.html'), 'utf8') : '';
  const entry = /<script[^>]*type="module"[^>]*src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
  const assets = built ? fs.readdirSync(path.join(dist, 'assets')) : [];
  const read = (f: string) => fs.readFileSync(path.join(dist, f), 'utf8');

  it('has a single module entry', () => {
    expect(entry).toBeTruthy();
  });

  it('keeps `__gt` out of the entry chunk', () => {
    expect(read(entry!)).not.toContain('__gt');
  });

  it('ships the test surface as a separate chunk the harness can ask for', () => {
    const withGt = assets.filter(f => f.endsWith('.js') && read('assets/' + f).includes('__gt'));
    expect(withGt.length).toBe(1);
    expect('assets/' + withGt[0]).not.toBe(entry);
  });

  it('references no third-party host from the page', () => {
    expect(html).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)/);
  });

  it('is a document with a doctype, a language and a description', () => {
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="description"');
  });
});
