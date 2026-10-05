/* Entry for the Node bundle verification/.build/gt.cjs (see scripts/build-shims.mjs).
   It exposes createGt() on globalThis so `gate:lib` can measure the library without a browser, with the
   same satellite.js ES build the app bundles. Not part of the app. */
import * as satellite from 'satellite.js';
import { createGt } from '../gt';

(globalThis as unknown as Record<string, unknown>).__createGtForNode =
  (catalogueText: string) => createGt({ satellite, catalogueText });
