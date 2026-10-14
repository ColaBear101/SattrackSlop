<script lang="ts">
  import { forget, searchAfterForget, survey } from '../../lib/forget';
  import { FORGET_ARMED_LABEL, FORGET_BLOCKED, FORGET_LABEL, FORGET_NOTHING, forgetArmed, forgetLeft } from '../../lib/text/forget';
  import { browserStore } from '../../state/storage';
  import Button from '../ui/Button.svelte';

  /* Forget what this page stored (CHANGES-FROM-LEGACY.md, L50). Two presses and no dialog: the first reads what is in the browser at that
     moment and says what will go, the second removes every key of the page's (lib/forget.ts) and opens the page again, so that nothing held
     in memory from what was stored (the site, the orbits, the theme) outlives it. Escape, the focus leaving the button, or a press anywhere
     else (a browser that does not focus a button it clicks never blurs it) stands it down; Escape is heard on the document, since such a
     browser sends it to the body. The second press must be a press of its own: one within GAP_MS of the first is the second click of a
     double-click or a double tap and is ignored, and a held Enter's repeats (which click again in Chromium and Firefox) are not presses.
     Nothing is read or written until the first press. A div and a paragraph, not a span: the golden capture reads the footer's spans as
     the old page's words. */
  const GAP_MS = 600;
  let armed = $state(false);
  let armedAt = 0;
  let said = $state('');
  let box: HTMLElement | undefined = $state();

  function standDown() { armed = false; said = ''; }

  function press() {
    const store = browserStore();
    if (!armed) {
      const s = survey(store);
      said = !s ? FORGET_BLOCKED : !s.parts.length ? FORGET_NOTHING : forgetArmed(s.parts);
      armed = !!s && s.parts.length > 0;
      armedAt = performance.now();
      return;
    }
    if (performance.now() - armedAt < GAP_MS) return;
    armed = false;
    if (!store) { said = FORGET_BLOCKED; return; }
    const { left } = forget(store);
    if (left.length) { said = forgetLeft(left.length); return; }
    /* the address without what would bring some of it back (the site's position, a tab the page would save again); a fragment alone would
       only scroll, so an address that differs in nothing else is reloaded */
    const q = searchAfterForget(location.search);
    if (q === location.search && !location.hash) location.reload();
    else location.replace(location.pathname + q);
  }

  /* a held Enter: its first keydown presses, its repeats do not (the keypress that would click is not sent) */
  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.repeat) e.preventDefault();
  }

  $effect(() => {
    if (!armed) return;
    const away = (e: PointerEvent) => { if (box && !box.contains(e.target as Node)) standDown(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); standDown(); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  });
</script>

<div id="footforget" bind:this={box}>
  <Button id="forgetbtn" size="sm" aria-describedby="forgetsay" onclick={press} onkeydown={key} onblur={standDown}>{armed ? FORGET_ARMED_LABEL : FORGET_LABEL}</Button>
  <p id="forgetsay" role="status">{said}</p>
</div>

<style>
  #footforget { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
  #forgetsay { flex: 1 1 18rem; margin: 0; min-width: 0; overflow-wrap: anywhere; }   /* empty, and still in the page: a live region that is not rendered is not read when it fills */
</style>
