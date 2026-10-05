<script lang="ts">
  import { app } from '../../state/app.svelte';

  /* "Orbit in this window": what the propagation measured, beside what the element set says. */
  const a = $derived(app.analysis);
  const E = $derived(a?.E);
  const P = $derived(E ? (E.periodShown ?? E.period) : 0);
  const rows = $derived(!a || !E ? [] : [
    ['Mean motion', E.n.toFixed(8), 'rev/day'],
    [E.periodKind === 'keplerian' ? 'Keplerian period' : 'Nodal period', (P / 60).toFixed(2), 'min'],
    ['Mean altitude', a.meanAlt.toFixed(1), 'km'],
    ['Min altitude', E.perigeeAlt.toFixed(1), 'km'],
    ['Max altitude', E.apogeeAlt.toFixed(1), 'km'],
    ['Revs in ' + a.hours + ' h', (a.hours * 3600 / P).toFixed(2), ''],
    ['B* drag term', E.bstar.toExponential(4), '1/ER'],
    ['Rev. no. at epoch', String(E.rev), '']
  ] as [string, string, string][]);
</script>

<dl id="minigrid">
  {#each rows as [k, v, u] (k)}
    <div><dt class="eyebrow">{k}</dt><dd class="mono">{v}{#if u} <small>{u}</small>{/if}</dd></div>
  {/each}
</dl>

<style>
  dl { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-4); }
  dt { font-size: 11px; letter-spacing: .08em; }
  dd { margin: 2px 0 0; font-size: var(--fs-2); }
  small { color: var(--muted); font-size: var(--fs-0); }
</style>
