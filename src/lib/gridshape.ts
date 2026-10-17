/* The shape of a Maidenhead locator, apart from the code that reads one (CHANGES-FROM-LEGACY.md, L51).
 *
 * The observer form reads a grid square typed into its place search on the page, and sends nothing; the code that reads
 * one (maidenhead.ts, with its words in text/grid.ts) is a chunk the form loads when it first opens. Text with a
 * locator's shape must not reach the place search while that chunk is on its way, or when it cannot be fetched at all
 * (a tab left open across a new release asks for a chunk the server no longer has), so the shape alone is here, in the
 * entry, at a cost of a few dozen bytes: the form asks it before anything is sent anywhere.
 *
 * Pure: no DOM, no globals. */

/** A locator the page reads: 4, 6 or 8 characters (a field alone is not taken: two letters are a place name as often). */
export const LOCATOR = /^([A-Ra-r]{2})(\d{2})(?:([A-Xa-x]{2})(\d{2})?)?$/;
/** A locator the page does not read: one caught half way through its last pair (5 or 7 characters, OK03g, OK03gs1),
 *  and one that goes past the extended square into the fifth pair, a-x, that some programs and GPS units add (9 or
 *  10 characters, OK03gs01a, OK03gs01ab). No place name and no postcode looks like either. Shorter starts (OK, OK0)
 *  are not taken: they are the start of a place name or a postcode district as often. */
export const PART = /^[A-Ra-r]{2}\d{2}(?:[A-Xa-x]|[A-Xa-x]{2}\d|[A-Xa-x]{2}\d{2}[A-Xa-x]{1,2})$/;

/** Whether text has a locator's shape, read or not: such text is never sent to the place search unasked. */
export function gridShaped(text: string): boolean {
  const t = String(text ?? '').trim();
  return LOCATOR.test(t) || PART.test(t);
}
