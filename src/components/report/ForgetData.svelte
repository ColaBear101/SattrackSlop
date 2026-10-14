<script lang="ts">
  import { forget, searchAfterForget, survey } from '../../lib/forget';
  import { FORGET_ARMED_LABEL, FORGET_BLOCKED, FORGET_LABEL, FORGET_NOTHING, forgetArmed, forgetLeft } from '../../lib/text/forget';
  import { browserStore } from '../../state/storage';
  import Button from '../ui/Button.svelte';

  /* Forget what this page stored (CHANGES-FROM-LEGACY.md, L50). Two presses and no dialog: the first reads what is in the browser at that
     moment and says what will go, the second removes every key of the page's (lib/forget.ts) and opens the page again, so that nothing held
     in memory from what was stored (the site, the orbits, the theme) outlives it. Escape, the focus leaving the button, or a press anywhere
     else (a browser that does not focus a button it clicks never blurs it) stands it down. Nothing is read or written until the first press.
     A div and a paragraph, not a span: the golden capture reads the footer's spans as the old page's words. */
  let armed = $state(false);
  let said = $state('');
  let box: HTMLElement | undefined = $state();

  function standDown() { armed = false; said = ''; }

  function press() {
    const store = browserStore();
    if (!armed) {
      const s = survey(store);
      said = !s ? FORGET_BLOCKED : !s.parts.length ? FORGET_NOTHING : forgetArmed(s.parts);
      armed = !!s && s.parts.length > 0;
      return;
    }
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

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape' && armed) { e.preventDefault(); standDown(); }
  }

  $effect(() => {
    if (!armed) return;
    const away = (e: PointerEvent) => { if (box && !box.contains(e.target as Node)) standDown(); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
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
