<script lang="ts">
  /* A small inline icon set: 24-unit grid, 1.75 stroke, currentColor. Decorative by default (the control that
     holds it carries the label); pass `label` when an icon stands alone. */
  type Name = 'chevron-down' | 'chevron-left' | 'chevron-right' | 'search' | 'pin' | 'sun' | 'moon' | 'auto'
    | 'play' | 'pause' | 'step-back' | 'step-fwd' | 'x' | 'orbit' | 'info' | 'check' | 'alert' | 'globe' | 'map'
    | 'clock' | 'plus' | 'external' | 'target';
  let { name, size = 18, label = '' }: { name: Name; size?: number; label?: string } = $props();

  const paths: Record<Name, string> = {
    'chevron-down': 'M6 9l6 6 6-6',
    'chevron-left': 'M15 6l-6 6 6 6',
    'chevron-right': 'M9 6l6 6-6 6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    pin: 'M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10zM12 8.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    auto: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 3a9 9 0 0 1 0 18',
    play: 'M7 4.5v15l12-7.5z',
    pause: 'M8 5v14M16 5v14',
    'step-back': 'M17 5l-9 7 9 7zM6 5v14',
    'step-fwd': 'M7 5l9 7-9 7zM18 5v14',
    x: 'M6 6l12 12M18 6L6 18',
    orbit: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3 12c0-3 4-5.5 9-5.5s9 2.5 9 5.5-4 5.5-9 5.5S3 15 3 12z',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8v.01',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.01',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    plus: 'M12 5v14M5 12h14',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5v1'
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round" role={label ? 'img' : undefined}
     aria-label={label || undefined} aria-hidden={label ? undefined : 'true'} focusable="false">
  <path d={paths[name]} />
</svg>

<style>
  svg { flex: none; display: block; }
</style>
