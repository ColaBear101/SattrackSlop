/* A number field beside a slider, in the close-up's card and its "How it flies" panel (CHANGES-FROM-LEGACY.md, L77): while it is typed
   in, only what is a number as it stands (not "-" or "1.") and one the field can hold as it is (so nothing is written back over the
   typing); when it is changed (Enter, or the focus leaving it), whatever it holds, and then it shows what was kept. */

/** What is typed, when it is already a value the field holds as it is; else null. */
export function typed(el: HTMLInputElement, hold: (v: number) => number): number | null {
  const v = el.value !== '' && String(+el.value) === el.value ? +el.value : null;
  return v !== null && hold(v) === v ? v : null;
}

/** The field changed: set what it holds, and show what was kept. */
export function changed(el: HTMLInputElement, set: (v: number) => void, now: () => number): void {
  if (el.value !== '') set(+el.value);
  el.value = String(now());
}
