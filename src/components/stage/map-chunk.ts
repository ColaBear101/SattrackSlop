/* The flat map's chunk (CHANGES-FROM-LEGACY.md, L86): the map itself, its Layers panel and full screen, and its key's rows for the
   catalogue's dots, fetched by the stage the first time the Map tab is shown. The globe is the first screen, so none of it is in the
   entry; the key's fixed rows and the readouts stay in the stage, where they are in the page from the start. */
export { default as MapView } from './MapView.svelte';
export { default as MapKey } from './MapKey.svelte';
