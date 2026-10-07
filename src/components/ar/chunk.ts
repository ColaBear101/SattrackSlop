/* What the lazy chunk holds: the AR view's markup, its controller and the two libraries it reads. session.svelte.ts imports this one module
   by name, so they travel together (and the Node shim, which has no use for the markup, imports the libraries on their own). */
export { default as ArRoot } from './ArRoot.svelte';
export { makeARView } from '../../lib/ar/arview';
export { SkyAR } from '../../lib/ar/skyar';
export { WMM } from '../../lib/ar/wmm';
