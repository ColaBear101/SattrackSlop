import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as CMP from '../../src/lib/text/life-compare';
import { CMP_OPEN, CMP_OPEN_FAILED } from '../../src/lib/text/life-compare-open';

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

  /* The decay comparison (CHANGES-FROM-LEGACY.md, L66) is a chunk of its own, DecayCompare, asked for at the first press of "Compare
     with other spacecraft". The entry (the module script and what index.html preloads with it) holds none of its words; the report's
     chunk, counted on every visit, holds the opener's two (life-compare-open.ts) and the record's key once, as the probe, and none of
     the comparison's own words. Its own words are life-compare.ts's sentences and names, but the few the page already says elsewhere
     in the same words: the picker's "nothing matches", the single chart's 120 km line, the section's "Mean altitude" and "Decay rate",
     and "element sets". The sentences its functions build ("Added ISS (ZARYA) · 3 in the comparison") are checked by their pieces:
     every quoted literal of 12 or more characters in its source, its imports left out (the regex takes whole literals and comments in
     order, so no two quotes of different literals pair up). */
  describe('the decay comparison', () => {
    const preload = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/(assets\/[^"]+\.js)"/g)].map(m => m[1]!);
    const entryCode = built ? [entry!, ...preload].map(read).join('\n') : '';
    const named = (re: RegExp) => assets.filter(f => re.test(f));
    const SHARED = new Set<string>([CMP.CMP_NO_MATCH, CMP.CMP_REENTRY, CMP.CMP_ALT_NAME, CMP.CMP_RATE_NAME, 'element sets']);
    const own = Object.values(CMP).filter((v): v is string => typeof v === 'string' && v.length >= 14 && !SHARED.has(v));
    const source = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'text', 'life-compare.ts'), 'utf8').replace(/^import [^\n]*\n/gm, '');
    const pieces = [...new Set([...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'((?:[^'\\\n]|\\.)*)'/g)].map(m => m[1]))]
      .filter((v): v is string => v !== undefined && v.length >= 12 && !SHARED.has(v) && !own.includes(v));

    it('builds its sentences from pieces of its own source', () => {
      expect(pieces.length).toBeGreaterThanOrEqual(30);
      for (const w of ['Press again to clear the comparison of ', ' in the comparison', 'Cleared the comparison of ', ' are highlighted']) {
        expect(pieces, w).toContain(w);
      }
    });

    it('is one chunk, DecayCompare, holding its own words', () => {
      const chunk = named(/^DecayCompare-/);
      expect(chunk).toHaveLength(1);
      expect(chunk[0]).toMatch(/^DecayCompare-[A-Za-z0-9_-]{8}\.js$/);
      expect(own.length).toBeGreaterThanOrEqual(10);
      const code = read('assets/' + chunk[0]);
      for (const w of [...own, ...pieces]) expect(code, w).toContain(w);
    });

    it('keeps every word of it, and its record, out of the entry', () => {
      expect(preload.length).toBeGreaterThan(0);
      for (const w of [...own, ...pieces, CMP_OPEN, CMP_OPEN_FAILED, 'gt.decaycmp']) expect(entryCode, w).not.toContain(w);
    });

    it('leaves the report\'s chunk only the opener\'s words and the record\'s key, read once', () => {
      const report = named(/^Report-[A-Za-z0-9_-]{8}\.js$/);
      expect(report).toHaveLength(1);
      const code = read('assets/' + report[0]);
      expect(code).toContain(CMP_OPEN);
      expect(code).toContain(CMP_OPEN_FAILED);
      expect(code.split('gt.decaycmp').length - 1).toBe(1);
      for (const w of [...own, ...pieces]) expect(code, w).not.toContain(w);
    });
  });
});
