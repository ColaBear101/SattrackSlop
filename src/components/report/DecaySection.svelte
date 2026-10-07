<script lang="ts">
  import { onMount } from 'svelte';
  import { life } from '../../state/life.svelte';
  import { prefs } from '../../state/prefs.svelte';
  import type { Geom, KeyItem, LifeColors } from './draw-life';
  import Button from '../ui/Button.svelte';
  import Rich from '../ui/Rich.svelte';

  /* (d) Orbital decay and remaining life: the mean altitude's history and the projection to re-entry, what the estimate says
     and what it is and is not. Fetching the history is a network call that has taken from a few seconds to over a minute, so
     it runs only when asked (state/life.svelte.ts); the panel says that, then what it found. The words are the old page's,
     moved verbatim (lib/text/life-words.ts); the chart is draw-life.ts.

     The chart, the drag model and the sentences that read a history are a chunk of their own (about 8 KB gzipped, of no use
     until there is something to draw): it is fetched when the section is within a screen or two of view, and a forecast waits
     for it (life.chartReady), so the words and the chart arrive together. Until then the canvas is empty, and nothing else on
     the page is waiting for it. */
  type ChartCode = typeof import('./draw-life');
  let canvas: HTMLCanvasElement;
  let code = $state.raw<ChartCode | null>(null);
  let loading: Promise<void> | null = null;
  const want = (): Promise<void> => (loading ??= import('./draw-life').then(m => { code = m; }, e => { loading = null; throw e; }));
  let colors = $state.raw<LifeColors | null>(null);
  let resized = $state(0);
  let geom: Geom | null = null;
  let key = $state.raw<KeyItem[]>([]);
  let tip = $state.raw<{ text: string; x: number; y: number } | null>(null);
  let tipEl: HTMLElement | undefined = $state();

  onMount(() => {
    const ro = new ResizeObserver(() => resized++);
    ro.observe(canvas);
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { want().catch(() => {}); io.disconnect(); } }, { rootMargin: '1200px 0px' });
    io.observe(canvas);
    life.chartReady = want;                            // a forecast waits for the chart's code, so they arrive together
    return () => { ro.disconnect(); io.disconnect(); life.chartReady = null; };
  });
  $effect(() => { prefs.resolved; if (code) colors = code.readLifeColors(); });
  $effect(() => {
    resized;
    const st = life.chart;
    if (!code || !colors) return;
    const r = code.drawLife(canvas, st, colors);
    geom = r.geom; key = r.key; tip = null;
    (canvas as HTMLCanvasElement & { __geom?: Geom | null }).__geom = r.geom;       // where the chart put its axes, kept on the canvas as the old page kept it: the suites read it
  });

  function move(e: PointerEvent) {
    const st = life.chart;
    if (!code || !st || !geom) { tip = null; return; }
    const t = code.lifeTipAt(geom, st, e.clientX - canvas.getBoundingClientRect().left);
    if (!t) { tip = null; return; }
    /* the box stays inside the chart: its own width, not a fixed 118 px (the line "+2.7 y after epoch" is 139 px wide, and at
       the far right of a 390 px screen the box ended 7 px past the edge and widened the whole page) */
    const w = tipEl?.offsetWidth ?? 118;
    tip = { text: t.text, y: t.y, x: Math.min(geom.Wc - Math.max(118, w), Math.max(0, t.x + 12)) };
  }

  const v = $derived(life.view);
</script>

<section id="sec-life" aria-labelledby="sec-life-h">
  <header>
    <h2 id="sec-life-h">Orbital decay · remaining life</h2>
    <p class="hint" id="lifespan">{v.span}</p>
  </header>
  <div class="life">
    <div class="chart">
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas bind:this={canvas} id="lifecv" role="img" aria-label="Mean altitude history and projected decay" onpointermove={move} onpointerleave={() => (tip = null)}></canvas>
      <div class="tip mono" id="lifetip" class:on={!!tip} bind:this={tipEl} style={tip ? 'left:' + tip.x + 'px; top:' + tip.y + 'px' : ''}>{tip?.text ?? ''}</div>
      <p class="legend" id="lifelegend">{#each key as k}<span><i style="background:{k.color};{k.opacity ? 'opacity:' + k.opacity : ''}"></i>{k.text}</span>{/each}</p>
    </div>
    <div class="side">
      <div class="hero">
        <span class="big" id="lifebig">{v.big}</span>
        <span class="sub" id="lifesub">{v.sub}</span>
      </div>
      <dl class="facts">
        <div class="dv"><dt class="eyebrow">Mean altitude</dt><dd class="mono" id="lifealt">{life.fields.alt ?? '—'}</dd></div>
        <div class="dv"><dt class="eyebrow">Decay rate</dt><dd class="mono" id="liferate">{life.fields.rate ?? '—'}</dd></div>
        <div class="dv"><dt class="eyebrow">History</dt><dd class="mono" id="lifehist">{life.fields.hist ?? '—'}</dd></div>
      </dl>
      <p class="note" id="lifenote"><Rich value={v.note} />{#if v.action}<br><br><Button id="lifego" size="sm" onclick={() => life.start()}>{v.action === 'retry' ? 'Try again' : 'Estimate remaining life'}</Button>{/if}</p>
    </div>
  </div>
</section>

<style>
  section { padding: var(--space-6) 0; border-top: 1px solid var(--rule); scroll-margin-top: 56px; }
  header { display: grid; gap: var(--space-1); margin-bottom: var(--space-4); }
  .hint { color: var(--muted); font-size: var(--fs-1); min-height: 1.2em; }
  .life { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 900px) { .life { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); } }
  .chart { position: relative; }
  canvas { display: block; width: 100%; height: 290px; border: 1px solid var(--rule); border-radius: var(--r-3); background: var(--panel); }
  .tip {
    position: absolute; z-index: 2; display: none; padding: var(--space-1) var(--space-2); border: 1px solid var(--rule); border-radius: var(--r-2);
    background: var(--panel); color: var(--ink); font-size: var(--fs-0); white-space: pre-line; pointer-events: none; box-shadow: var(--shadow);
  }
  .tip.on { display: block; }
  .legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); margin: var(--space-3) 0 0; font-size: var(--fs-0); color: var(--muted); }
  .legend i { display: inline-block; width: 14px; height: 3px; margin-right: var(--space-2); vertical-align: middle; border-radius: 2px; }
  .side { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
  .hero { display: grid; gap: var(--space-1); }
  .big { font-family: var(--font-head); font-size: var(--fs-5); font-weight: 600; line-height: 1.1; color: var(--ink); font-variant-numeric: tabular-nums; }
  .sub { color: var(--muted); font-size: var(--fs-1); }
  .facts { margin: 0; display: grid; gap: var(--space-3); }
  .facts dd { margin: 2px 0 0; font-size: var(--fs-2); }
  .note { color: var(--ink2); font-size: var(--fs-1); line-height: var(--lh-body); max-width: 62ch; }
</style>
