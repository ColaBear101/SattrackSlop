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
    expect(html).toMatch(/<html lang="en"[ >]/);
    expect(html).toContain('<meta name="description"');
  });

  it('chooses the theme in the head, before the stylesheet can paint', () => {
    const inline = html.indexOf("localStorage.getItem('gt.prefs')");
    const sheet = html.indexOf('rel="stylesheet"');
    expect(inline).toBeGreaterThan(-1);
    expect(sheet).toBeGreaterThan(inline);
  });

  /* The footer's credit line (CHANGES-FROM-LEGACY.md, L49, which gives its words) states package.json's version: Vite writes it in, so no chunk may still
     name __APP_VERSION__ (it would throw in the page), and the chunk with the line carries the version. */
  it('has the version written in where the footer states it', () => {
    const js = assets.filter(f => f.endsWith('.js'));
    expect(js.filter(f => read('assets/' + f).includes('__APP_VERSION__'))).toEqual([]);
    const withCredit = js.filter(f => read('assets/' + f).includes(' (element sets, transmitters, alternative names), '));
    expect(withCredit.length).toBe(1);
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    expect(read('assets/' + withCredit[0])).toContain(version);
  });
});
