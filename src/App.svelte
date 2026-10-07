<script lang="ts">
  import AppBar from './components/shell/AppBar.svelte';
  import LoadNote from './components/shell/LoadNote.svelte';
  import Stage from './components/stage/Stage.svelte';
  import RailShell from './components/rail/RailShell.svelte';
  import AnswerRail from './components/rail/AnswerRail.svelte';
  import Transport from './components/transport/Transport.svelte';
  import Report from './components/report/Report.svelte';
  import PlannerHost from './components/planner/PlannerHost.svelte';
  import { onKey } from './state/shortcuts';
</script>

<svelte:window onkeydown={onKey} />

<a class="skip" href="#main">Skip to the page</a>
<AppBar />
<LoadNote />

<!-- class "app" is what the orbit planner's controller looks for: it sets data-planning on this element while the planner is open -->
<main id="main" class="app" tabindex="-1">
  <div class="console">
    <div class="stage-zone"><Stage /></div>
    <div class="planner-zone"><PlannerHost place="zone" /></div>
    <div class="rail-zone"><RailShell><AnswerRail /></RailShell></div>
    <div class="transport-zone"><Transport /></div>
  </div>
  <Report />
</main>
<!-- the planner's body-level pieces (#pl-live, the glyph sprite): direct children of the mount node, outside <main> -->
<PlannerHost place="root" />

<style>
  .skip {
    position: absolute; left: var(--space-3); top: -48px; z-index: var(--z-dialog); padding: var(--space-2) var(--space-3);
    background: var(--sel-bg); color: var(--sel-ink); border-radius: var(--r-2); font-weight: 500; text-decoration: none;
  }
  .skip:focus { top: var(--space-2); }
  main { display: block; outline: none; }

  /* narrow and middle: everything in one column, in reading order. The rail's own shell decides whether it is
     a folded panel (middle) or a fixed sheet that takes no room here (narrow). */
  .console { display: grid; grid-template-columns: minmax(0, 1fr); }
  .transport-zone { order: 2; }            /* the controls sit under the picture they drive, ahead of the rail's panel */
  .rail-zone { order: 3; }
  /* the answer sheet is fixed along the bottom edge: the page leaves room for it at its end, and whatever the browser scrolls into view
     (a focused field, the planner's Undo under its list) lands above it, not under it */
  @media (max-width: 719px) { main { padding-bottom: 72px; } :global(html) { scroll-padding-bottom: 72px; } }

  /* wide: the console fills the screen under the bar, stage and rail side by side, the transport docked below */
  @media (min-width: 1100px) {
    .console {
      height: calc(100dvh - var(--bar-h)); min-height: 600px;
      grid-template-columns: minmax(0, 1fr) var(--rail-w); grid-template-rows: minmax(0, 1fr) auto;
      grid-template-areas: 'stage rail' 'transport transport';
    }
    .stage-zone { grid-area: stage; min-height: 0; overflow: auto; }
    .rail-zone { grid-area: rail; min-height: 0; overflow: hidden; }
    .transport-zone { grid-area: transport; }
  }

  /* The orbit planner's cell. It is nothing while the planner is shut: the controller sets data-planning on <main> when it opens
     and takes it off when it closes. Open, it has three presentations (components/planner/planner.css says what is inside),
     chosen by the media queries the controller reads in mode(), which are written here in the same words:
       flow    <= 900 px wide: a panel in the one column, between the stage and the transport; the rail is still there below
       drawer  >= 901 wide and >= 561 tall: the console becomes the wide layout whatever its width, and the planner takes the
               rail's cell, wider than the rail was (the rail is hidden while it is open)
       sheet   >= 901 wide and <= 560 tall: the planner is fixed over the whole screen and takes no cell; the stage keeps the
               width and the rail is hidden */
  .planner-zone { display: none; }
  .app:global([data-planning]) .planner-zone { display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); min-width: 0; min-height: 0; order: 1; }

  @media (min-width: 901px) and (min-height: 561px) {
    .app:global([data-planning]) .rail-zone { display: none; }
    .app:global([data-planning]) .console {
      height: calc(100dvh - var(--bar-h)); min-height: 0;     /* the planner's Add bar stays in view: the console is what is left of the screen */
      grid-template-columns: minmax(0, 1fr) clamp(372px, 31vw, 456px); grid-template-rows: minmax(0, 1fr) auto;
      grid-template-areas: 'stage planner' 'transport transport';
    }
    .app:global([data-planning]) .stage-zone { grid-area: stage; min-height: 0; overflow: auto; }
    .app:global([data-planning]) .planner-zone { grid-area: planner; overflow: hidden; }
    .app:global([data-planning]) .transport-zone { grid-area: transport; }
    /* below 1100 px the globe is sized for a one-column page; here it is in a cell, so it takes the wide layout's height */
    .app:global([data-planning]) .stage-zone :global(.viewport) { height: clamp(340px, calc(100dvh - var(--bar-h) - var(--transport-h) - 132px), 880px); }
    /* The stage keeps its gutters, so the narrowest drawer (901 px) leaves the globe 497 px, and the clock on its left meets the camera row on its
       right ("UTC" ran into "CAMERA"). Up to 940 px the captions go, as they do on a phone; the buttons say what they are. */
    @media (max-width: 940px) { .app:global([data-planning]) .stage-zone :global(.seglabel) { display: none; } }
  }
  @media (min-width: 901px) and (max-height: 560px) {
    .app:global([data-planning]) .rail-zone { display: none; }
    .app:global([data-planning]) .console { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'stage' 'transport'; }
    .app:global([data-planning]) .planner-zone { display: contents; }
  }
</style>
