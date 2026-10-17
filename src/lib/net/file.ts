/* The page's own data files (data/*.json named by a `?url` import, served as assets/<name>-<hash>.json, the same bytes), fetched when
 * first wanted. Fetched rather than imported as a chunk because a browser keeps a failed import() for the life of the page: a second
 * import of a chunk that did not arrive fails at once without asking again (Chromium does, as the module map of the HTML standard says),
 * so no retry could bring it. A fetch that failed is asked again (CHANGES-FROM-LEGACY.md, L65). */

/** One promise for every caller while it is on its way or has come; a failure is forgotten, so the next call asks again (a lost
 *  file on a flaky connection is not the end of the table for the visit). */
export function retrying<T>(get: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= get().catch((e: unknown) => { p = null; throw e; }));
}

/** The file's JSON. A refusal is a failure (an HTTP error, a dropped connection), and so is anything whose `key` is not an object: a
 *  host's error page read as JSON, a cut answer. */
export const fetchTable = (url: string, key: string): Promise<unknown> => fetch(url).then(r => {
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json() as Promise<unknown>;
}).then(d => {
  if (!(Object(d)[key] instanceof Object)) throw new Error('not the table');
  return d;
});
