<script lang="ts">
  import AppBar from './components/shell/AppBar.svelte';
  import LoadNote from './components/shell/LoadNote.svelte';
  import Stage from './components/stage/Stage.svelte';
  import RailShell from './components/rail/RailShell.svelte';
  import AnswerRail from './components/rail/AnswerRail.svelte';
  import Transport from './components/transport/Transport.svelte';
  import Report from './components/report/Report.svelte';
  import { onKey } from './state/shortcuts';
</script>

<svelte:window onkeydown={onKey} />

<a class="skip" href="#main">Skip to the page</a>
<AppBar />
<LoadNote />

<main id="main" tabindex="-1">
  <div class="console">
    <div class="stage-zone"><Stage /></div>
    <div class="rail-zone"><RailShell><AnswerRail /></RailShell></div>
    <div class="transport-zone"><Transport /></div>
  </div>
  <Report />
</main>

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
  @media (max-width: 719px) { main { padding-bottom: 72px; } }

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
</style>
