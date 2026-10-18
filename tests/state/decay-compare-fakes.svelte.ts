import { vi } from 'vitest';
import type { CatalogueEntry } from '../../src/lib/catalogue/parse';

/* Stand-ins for the console's own store and the Decay section's (app.svelte.ts starts the whole page; life.svelte.ts reaches the
   network and the planner), reactive as theirs are: the comparison derives the selected spacecraft from app.entry and its first line
   from life.chart. tests/state/decay-compare.test.ts mocks both modules with this one. Vitest keeps a mocked module across vi.resetModules(), so the
   same two stand-ins serve every test, and each test resets them. */

const entry = (satnum: string, name: string): CatalogueEntry => ({ satnum, name, l1: '1 ' + satnum + 'U', l2: '2 ' + satnum });

/** the spacecraft the tests use, and forty more for the watchlist */
export const CATALOGUE: CatalogueEntry[] = [
  entry('25544', 'ISS (ZARYA)'), entry('07530', 'OSCAR 7'), entry('67683', 'KNACKSAT-2'), entry('43017', 'FOX-1B'),
  entry('39444', 'FUNCUBE-1'), entry('26931', 'INTELSAT 901'),
  ...Array.from({ length: 40 }, (_, i) => entry(String(40000 + i), 'SAT ' + (40000 + i)))
];

class FakeApp {
  catalogue = $state.raw<CatalogueEntry[]>(CATALOGUE);
  entry = $state.raw<(CatalogueEntry & { custom?: boolean }) | null>(null);
  note = $state('');
  embedded(n: string): CatalogueEntry | undefined { return this.catalogue.find(e => e.satnum === n); }
  reset(): void { this.catalogue = CATALOGUE; this.entry = null; this.note = ''; }
}
export const app = new FakeApp();

/* eslint-disable @typescript-eslint/no-explicit-any */
class FakeLife {
  view = $state.raw<{ big: string; action?: 'estimate' | 'retry' }>({ big: '—' });
  chart = $state.raw<{ P: { t: number; sma: number }[]; r: any; custom?: boolean } | null>(null);
  /** the section's own request: resolves when the test says */
  start = vi.fn(() => new Promise<void>(res => { this.finish = res; }));
  offer = vi.fn();
  finish: () => void = () => {};
  reset(): void { this.view = { big: '—' }; this.chart = null; this.start.mockClear(); this.offer.mockClear(); this.finish = () => {}; }
}
export const life = new FakeLife();
