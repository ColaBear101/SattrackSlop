export type Theme = 'auto' | 'light' | 'dark';
export type StageTab = 'globe' | 'map';

const KEY = 'gt.prefs';

interface Saved { theme?: Theme; tab?: StageTab }

function read(): Saved {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}
function write(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window or full storage: the choice holds for this visit */ }
}

/** The things a visitor chooses and expects to find again. Small on purpose; the planner's saved orbits and the
 *  observer have their own keys, in the old page's formats. */
class Prefs {
  theme = $state<Theme>('auto');
  /** The globe is what the page opens on (the flat map when there is no WebGL, unless the reader chose). */
  tab = $state<StageTab>('globe');
  /** Did the reader (or a link) choose the tab? If not, a page that cannot draw the globe is free to open the map instead. */
  tabChosen = $state(false);
  /** What the theme actually is right now ('auto' resolved against the system). */
  resolved = $state<'light' | 'dark'>('light');

  private media: MediaQueryList | null = null;

  constructor() {
    const s = read();
    if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'auto') this.theme = s.theme;
    if (s.tab === 'globe' || s.tab === 'map') { this.tab = s.tab; this.tabChosen = true; }
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.media = window.matchMedia('(prefers-color-scheme: dark)');
      this.media.addEventListener('change', () => { if (this.theme === 'auto') this.apply(); });
    }
    this.apply();
  }

  private apply(): void {
    const dark = this.theme === 'dark' || (this.theme === 'auto' && !!this.media?.matches);
    this.resolved = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', this.resolved);
  }

  private save(): void { write({ theme: this.theme, tab: this.tab }); }

  setTheme(t: Theme): void { this.theme = t; this.apply(); this.save(); }
  /** light -> dark -> auto -> light: three states, one button. */
  cycleTheme(): void { this.setTheme(this.theme === 'light' ? 'dark' : this.theme === 'dark' ? 'auto' : 'light'); }
  setTab(t: StageTab): void { this.tab = t; this.tabChosen = true; this.save(); }
  /** Show this tab because the other cannot be drawn, without remembering it as a choice. */
  fallback(t: StageTab): void { if (!this.tabChosen && this.tab !== t) this.tab = t; }
}

export const prefs = new Prefs();
