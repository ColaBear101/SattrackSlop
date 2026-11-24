---
type: concept
title: "Reader-uploaded 3D models"
tags: [globe, earth-console, data]
sources: [readme-globe-and-views]
created: 2026-11-24
updated: 2026-11-24
---

# Reader-uploaded 3D models

A reader may give the [[close-up-camera]] a 3D model of their own for any spacecraft, through *Your model…* on the close-up's card (ledger row L73 of the [[change-ledger]]). The model is validated locally, shown immediately, and if kept is stored only in this browser; it is never sent anywhere (README.md#L1024-L1031).

## Accepted files

A `.glb`, or a `.gltf` that carries its data inside it (README.md#L1024-L1025).

## Validation

The file is checked before anything is built from it, in `src/lib/models/validate.ts` (README.md#L1025-L1029):

- its size — 50 MB at most;
- its header and its description;
- any extension it needs that the page cannot read without a decoder — Draco, meshopt, Basis — is refused;
- every buffer and image must be inside the file: a model that points at the web is refused, and nothing it names is ever fetched;
- its size in triangles.

## Fitting it

The model is shown at once with its size, so a file in millimetres "shows itself up"; controls for units and two axes turn it until it looks right (README.md#L1029-L1030). Its flight can then be set like any model's (see [[spacecraft-attitude]]); a reader's model takes its attitude setting with it when removed or replaced (README.md#L1018-L1019).

## Storage and removal

- *Keep this model* files it in this browser only, in IndexedDB; it is never sent anywhere (README.md#L1031).
- A kept model wins over the page's own model for that spacecraft; *Remove my model* gives the page's back (README.md#L1031-L1032).
- *Forget what this page stored* removes it with everything else (README.md#L1032-L1033; see [[forget-data]]). The models live in the IndexedDB database `gt-models`, written only by `src/state/models.svelte.ts`; their list, `gt.models`, sits in `localStorage` and is reported as e.g. "2 3D models you added"; the second press of Forget deletes the database too (README.md#L1138-L1142).
- A private window, or the snapshot under `?tle=embedded`, keeps the model for the visit only, and says so (README.md#L1033-L1034; see [[assignment-snapshot-tle-embedded]]).

## Related

- [[close-up-camera]] — the bundled models this can replace.
- [[data-provenance]] — what the page fetches and stores in general.
