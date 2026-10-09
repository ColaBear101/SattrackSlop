<script lang="ts">
  /* The sky through the phone: the markup of the AR view, as the old page had it (legacy/index.html, the div.arview block, and its
     stylesheet), and nothing else.

     src/lib/ar/arview.ts finds every node here by id, writes its text and attributes, and attaches every listener (init()): so this
     component is deliberately inert - no handlers, nothing bound into a node the controller writes, no {#if} or {#each} around any
     of it. A node whose text the controller replaces is rendered once, with the words it starts with. The ids, roles, aria wiring,
     classes and static strings are the old page's on purpose: the controller, the stylesheet and the oracle suite key on them.

     It is mounted as a direct child of <body>, outside the app's mount node (src/components/ar/session.svelte.ts): opening the view
     makes every other child of <body> inert, so a root inside the app's own node would be made inert with its parent.

     The stylesheet is global because the controller sets the status line's class name wholesale (a scoped rule would stop matching the
     first time it did). Every selector begins with .arview or an ar- name. */
</script>

<div class="arview" id="arview" role="dialog" aria-modal="true" aria-labelledby="ar-title" aria-describedby="ar-status" hidden>
  <video class="ar-video" id="ar-video" playsinline muted autoplay disablepictureinpicture aria-hidden="true"></video>
  <canvas class="ar-sky" id="ar-sky" aria-hidden="true"></canvas>
  <div class="ar-top">
    <div>
      <h2 class="ar-title" id="ar-title">Sky over <span id="ar-site">Bangkok</span></h2>
      <p class="ar-sub"><span id="ar-pos">—</span>{' '}<button class="btn" id="ar-here" type="button">Use my location</button></p>
    </div>
    <button class="btn" id="ar-close" type="button">Close</button>
  </div>
  <p class="ar-status" id="ar-status" role="status" aria-live="polite"></p>
  <div class="ar-read">
    <dl class="ar-dl">
      <div><dt>View</dt><dd id="ar-view">—</dd></div>
      <div class="ar-more"><dt>North</dt><dd id="ar-north">—</dd></div>
      <div class="ar-more"><dt>Declination</dt><dd><span id="ar-decl">—</span>{' '}·{' '}<abbr title="World Magnetic Model 2025: the model of the Earth’s magnetic field that NOAA and the British Geological Survey publish for 2025 to 2030">WMM2025</abbr></dd></div>
      <div class="ar-clockrow"><dt>Clock</dt><dd id="ar-clock">—</dd></div>
      <div><dt>Target</dt><dd id="ar-target">—</dd></div>
      <div><dt>Pass</dt><dd id="ar-pass">—</dd></div>
    </dl>
    <div class="ar-actions">
      <button class="btn" id="ar-live" type="button" hidden>Go live</button>
      <button class="btn" id="ar-retry" type="button" hidden>Try again</button>
      <button class="btn" id="ar-alignbtn" type="button" aria-expanded="false" aria-controls="ar-align">Align</button>
    </div>
    <div class="ar-align" id="ar-align" hidden>
      <button class="btn" id="ar-left" type="button" aria-label="Move the drawn sky one degree left">◂ 1°</button>
      <button class="btn" id="ar-right" type="button" aria-label="Move the drawn sky one degree right">1° ▸</button>
      <button class="btn" id="ar-trim0" type="button">Reset heading</button>
      <label class="ar-lens"><span id="ar-lensv">Lens 68.0°</span>
        <input type="range" id="ar-fov" min="45" max="80" step="0.5" value="68"
               aria-label="Width of the camera’s view across its long side, in degrees"></label>
      <button class="btn" id="ar-fov0" type="button">Reset lens</button>
    </div>
  </div>
</div>

<style>
  /* ---- the sky through the phone -------------------------------------------
   * The AR view covers the page. Over a camera's picture there is no light or dark theme to follow - the picture is whatever the sky
   * is - so the palette is fixed: the globe's on-screen colours, which are the ones a reader has learned (cyan the spacecraft,
   * orange in view from the site, pink the mask), cased in the HUD's dark halo so they hold up over a daylit sky. The canvas reads
   * them from these properties, which therefore live on the view itself. */
  :global(:root.ar-open) { overflow: hidden; }
  :global {
    .arview {
      position: fixed; inset: 0; z-index: var(--z-ar, 200); background: #05090C; color: #EAF2F6; overflow: hidden;
      touch-action: none; overscroll-behavior: none; -webkit-user-select: none; user-select: none;
      -webkit-touch-callout: none; font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-variant-numeric: tabular-nums;
      --ar-ink: #EAF2F6; --ar-ink2: #AFC3CE; --ar-halo: #05090C; --ar-grid: rgba(234,242,246,.30);
      --ar-horizon: rgba(234,242,246,.85); --ar-mask: #F29CBB; --ar-pass: #E8BC5A; --ar-craft: #55D1E7;
      --ar-sun: #FFE7A8; --ar-warn: #D69A5C;
    }
    /* the author rules below set display, and would otherwise beat [hidden] */
    .arview[hidden], .arview [hidden] { display: none; }
    .ar-video, .ar-sky { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .ar-video { object-fit: cover; object-position: 50% 50%; }
    .ar-top {
      position: absolute; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
      padding: calc(env(safe-area-inset-top) + 10px) calc(env(safe-area-inset-right) + 12px) 12px calc(env(safe-area-inset-left) + 12px);
      background: linear-gradient(rgba(5,9,12,.8), rgba(5,9,12,0)); pointer-events: none;
      text-shadow: 0 0 6px #05090C, 0 0 6px #05090C;
    }
    .ar-title { font: 600 13px/1.3 "IBM Plex Mono", ui-monospace, monospace; margin: 0; }
    .ar-sub { margin: 3px 0 0; font-size: 11px; color: #AFC3CE; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ar-status {
      position: absolute; left: 12px; right: 12px; top: calc(env(safe-area-inset-top) + 74px); margin: 0 auto; max-width: 34em;
      padding: 9px 12px; background: rgba(10,16,20,.88); border-left: 3px solid #D69A5C; border-radius: 0 3px 3px 0;
      font-size: 12.5px; line-height: 1.5; color: #CFE3EE; pointer-events: none;
    }
    .ar-status.info { border-left-color: #8AA0AC; }
    /* Empty, the box goes but the element stays: a live region taken out of the page while it is empty may not have what is then
       written into it read out. */
    .ar-status:empty { padding: 0; border: 0; background: none; }
    .ar-read {
      position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; gap: 6px;
      padding: 12px calc(env(safe-area-inset-right) + 12px) calc(env(safe-area-inset-bottom) + 12px) calc(env(safe-area-inset-left) + 12px);
      background: linear-gradient(rgba(5,9,12,0), rgba(5,9,12,.82) 30%); pointer-events: none;
    }
    .ar-dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; margin: 0; font-size: 11.5px; line-height: 1.45; text-shadow: 0 0 6px #05090C; }
    .ar-dl div { display: contents; }
    .ar-dl dt { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #8AA0AC; }
    .ar-dl dd { margin: 0; color: #DCE8EE; overflow-wrap: anywhere; }
    .ar-dl abbr[title] { pointer-events: auto; }
    .ar-actions, .ar-align { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .ar-align {
      padding: 8px; background: rgba(10,16,20,.86); border: 1px solid rgba(180,200,212,.28); border-radius: 3px;
      backdrop-filter: blur(6px); font-size: 11.5px; color: #C6D6DE; pointer-events: auto;
    }
    .ar-lens { display: flex; align-items: center; gap: 8px; flex: 1 1 100%; }
    .ar-lens input { flex: 1; accent-color: #55D1E7; }
    /* the buttons: the dark glass the globe's own buttons wear */
    .arview .btn {
      min-height: 40px; pointer-events: auto; padding: 0 12px; border: 1px solid rgba(180,200,212,.28); border-radius: 3px;
      background: rgba(10,16,20,.72); color: #DCE8EE; backdrop-filter: blur(6px); font: 500 12px "IBM Plex Mono", ui-monospace, monospace; letter-spacing: .02em;
    }
    .arview .btn:hover { background: rgba(180,200,212,.16); }
    .arview .btn:focus-visible, .arview input:focus-visible { outline: 2px solid #EAF2F6; outline-offset: 2px; }
    #ar-alignbtn[aria-expanded="true"] { background: #E8EFF2; border-color: #E8EFF2; color: #0A1016; }
    /* A phone held sideways has a 390 px sky, and the whole readout across its foot would leave a band of it. Half the width, the first
       way this was tried, covered the middle, which is where the spacecraft is when the phone is on it. So the readout is a third of the
       width and keeps what pointing needs - the view, the target, the pass, and the clock while it is not the present - and North and
       Declination are left to the phone held upright. */
    @media (orientation: landscape) and (max-height: 540px) {
      .ar-read { right: auto; width: min(34%, 20em); }
      .ar-dl .ar-more { display: none; }
      .arview:not([data-sim]) .ar-dl .ar-clockrow { display: none; }
      .ar-status { top: calc(env(safe-area-inset-top) + 62px); max-width: 30em; }
      /* Opened in that column, Align made it taller than the screen and pushed its own button, and Use my location under it, off the
         top. It is a panel of its own in the lower right instead, scrolling if it has to. */
      .ar-align {
        position: fixed; right: calc(env(safe-area-inset-right) + 12px); bottom: calc(env(safe-area-inset-bottom) + 12px);
        width: min(46%, 26em); max-height: calc(100% - 96px); overflow-y: auto;
      }
    }
  }
</style>
