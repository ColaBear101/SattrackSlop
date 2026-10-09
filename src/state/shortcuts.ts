import { clock, MAX_RATE } from './clock.svelte';
import { prefs } from './prefs.svelte';

/* Keys for the things done most while watching a pass. They never act on a key that has a meaning where the focus
   is: Space on a button presses it, the arrows on a slider move it, and anything typed into a field is the field's.
   "/" (the picker) is handled by the picker itself. */

const OWN_KEYS = /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/;

function takenByFocus(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  /* ...and a region the page made focusable on purpose (a table that scrolls sideways: its arrow keys are its own) */
  const region = t.getAttribute('tabindex') !== null && t.tabIndex >= 0;
  return OWN_KEYS.test(t.tagName) || t.isContentEditable || t.getAttribute('role') === 'tab' || region || !!t.closest('[role="dialog"]');
}

/** One minute a step, an hour with Shift. */
const STEP_MS = 60_000;

export function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.documentElement.classList.contains('ar-open')) return;        // the sky through the phone has the screen: the clock is not for keys now
  switch (e.key) {
    case ' ':
      if (takenByFocus(e)) return;
      if (e.repeat) { e.preventDefault(); return; }                          // held down it is one press, not a flicker of play and pause
      e.preventDefault(); clock.toggle(); return;
    case 'ArrowLeft': case 'ArrowRight':
      if (takenByFocus(e)) return;
      e.preventDefault();
      clock.seek(clock.now() + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 60 : 1) * STEP_MS, true);
      return;
    case '[': case ']': {
      if (takenByFocus(e) && (e.target as HTMLElement).tagName !== 'BUTTON') return;
      e.preventDefault();
      clock.setRate(e.key === ']' ? Math.min(MAX_RATE, clock.rate * 2) : Math.max(1, clock.rate / 2));
      return;
    }
    case 'g': case 'm':
      if (takenByFocus(e)) return;
      prefs.setTab(e.key === 'g' ? 'globe' : 'map');
      return;
  }
}
