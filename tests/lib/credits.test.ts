import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { creditLine, REPO_URL, SATNOGS_DB_URL, CC_BY_SA_URL } from '../../src/lib/text/credits';
import { plain, type Inline } from '../../src/lib/text/rich';
import { REPO_URL as SERVER_REPO_URL } from '../../server/config.js';
import viteConfig from '../../vite.config';
import pkg from '../../package.json';

/* The footer's credit line (CHANGES-FROM-LEGACY.md, L49): the version, the repository and the licence of the data the page carries
   from SatNOGS DB: the catalogue's element sets from its TLE list, the transmitter table and the alternative names (L61). It names no
   licence for the page's own code, which is MIT: the LICENSE file and package.json state that, and the page need not. */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const nodes = (x: Inline): Inline[] => typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(nodes) : [x];
const links = (x: Inline) => nodes(x).flatMap(n => typeof n === 'object' && !Array.isArray(n) && 'link' in n ? [n.link] : []);

describe('the credit line', () => {
  it('says the version it is given, the repository and the data licence, in that order, and no licence for the code', () => {
    expect(plain(creditLine('9.8.7'))).toBe('Ground Track Console 9.8.7 · github.com/ColaBear101/SattrackSlop · Data: SatNOGS DB (element sets, transmitters, alternative names), CC BY-SA 4.0');
    expect(plain(creditLine('9.8.7'))).not.toMatch(/\bMIT\b|licen[cs]e/i);
  });
  it('links the repository, SatNOGS DB and the licence deed (CC BY-SA asks for a link to the licence), all over https', () => {
    expect(links(creditLine('1.0.0'))).toEqual([
      { href: REPO_URL, text: 'github.com/ColaBear101/SattrackSlop' },
      { href: SATNOGS_DB_URL, text: 'SatNOGS DB' },
      { href: CC_BY_SA_URL, text: 'CC BY-SA 4.0' }
    ]);
    expect(CC_BY_SA_URL).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    for (const l of links(creditLine('1.0.0'))) expect(l.href).toMatch(/^https:\/\//);
  });
  it('is plain text and links only: no warn node, which Rich renders as a span, and the golden capture reads the footer\'s spans', () => {
    for (const n of nodes(creditLine('1.0.0'))) expect(typeof n === 'string' || 'link' in n).toBe(true);
  });
  it('names the repository the cache API names', () => {
    expect(REPO_URL).toBe(SERVER_REPO_URL);
  });
});

/* The owner's decision (L49, changed 2026-11-07): the project's own code is MIT. The repository says so, not the page: one LICENSE
   file at the root, and the same in package.json and the lock's root entry. The licences the lock records for the dependencies are
   theirs, and are not read here; the SatNOGS DB data keeps its own (CC BY-SA 4.0, the credit line above). */
describe('the code\'s licence', () => {
  it('is MIT: package.json and the lock\'s root entry say MIT, and the one licence file at the root is the MIT licence', () => {
    expect(pkg.license).toBe('MIT');
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { license?: string }> };
    expect(lock.packages[''].license).toBe('MIT');
    expect(fs.readdirSync(ROOT).filter(f => /^(licen[cs]e|copying)(\.|$)/i.test(f))).toEqual(['LICENSE']);
    const text = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
    expect(text.startsWith('MIT License')).toBe(true);
    expect(text).toContain('Copyright (c) 2026 Earth (ColaBear101)');
  });
});

describe('the version', () => {
  it('is package.json\'s, written into the build by Vite as __APP_VERSION__', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    expect((viteConfig as { define?: Record<string, string> }).define?.__APP_VERSION__).toBe(JSON.stringify(pkg.version));
  });
});
