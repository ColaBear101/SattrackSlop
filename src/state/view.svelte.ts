/* How much of the screen the globe has (CHANGES-FROM-LEGACY.md, L78): whether the answer panel is folded away on a wide screen, for as
   long as the page is open (nothing is stored), and whether the globe's view is full screen, as the browser says. */

class View {
  /** the answer panel folded away; it matters only where the panel sits beside the stage (1100 px and wider) */
  railHidden = $state(false);
  /** the globe's view is the element the browser shows full screen */
  full = $state(false);
  /** the timeline bar shown along the foot of the full-screen view (L85), or folded to its button, for as long as the page is open */
  timeShown = $state(true);
  /** the browser can show an element full screen (not an iPhone's Safari, which can only a video) */
  readonly canFull: boolean = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  constructor() {
    try { document.addEventListener('fullscreenchange', () => { this.full = !!document.fullscreenElement; }); } catch { /* no document */ }
  }

  /** The element (the globe's view) full screen, or back; a browser that refuses says nothing, and nothing changes. */
  toggleFull(el: Element | null): void {
    /* read again when the browser's answer comes, as well as on its event, which a browser does not always send to the page */
    const read = (): void => { this.full = !!document.fullscreenElement; };
    if (document.fullscreenElement) void document.exitFullscreen().then(read, read);
    else if (el) void el.requestFullscreen().then(read, read);
  }
}

export const view = new View();
