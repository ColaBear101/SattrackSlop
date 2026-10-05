/* A sentence with a little structure in it, as data.
 *
 * The old page built its prose as strings of HTML and assigned them with innerHTML, which is also how a hostile
 * spacecraft name once became script in the page's origin. The builders here return this instead: plain strings
 * and a handful of node kinds, rendered by components/ui/Rich.svelte with no {@html} anywhere. A word that wants an
 * explanation under the pointer is an `abbr`; emphasis is `b`; a line break is `br`. Arrays are sequences. */

export interface Abbr { abbr: { text: string; title: string } }
export interface Bold { b: Inline }
export interface Br { br: true }
/** A number or phrase that is flagged as old or out of range: rendered with the page's warning colour. */
export interface Warn { warn: Inline }
export interface Link { link: { href: string; text: string } }
export type Inline = string | Abbr | Bold | Br | Warn | Link | Inline[];

export const b = (x: Inline): Bold => ({ b: x });
export const br: Br = { br: true };
export const warn = (x: Inline): Warn => ({ warn: x });
export const link = (href: string, text: string): Link => ({ link: { href, text } });
export const abbr = (a: { text: string; title: string }): Abbr => ({ abbr: a });

/** The text a screen reader or a test would read: every node flattened, abbreviations as their short form. */
export function plain(x: Inline): string {
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(plain).join('');
  if ('abbr' in x) return x.abbr.text;
  if ('b' in x) return plain(x.b);
  if ('warn' in x) return plain(x.warn);
  if ('link' in x) return x.link.text;
  return '\n';
}

/** A labelled row of a facts list: the label and its value, both inline. */
export type Row = [Inline, Inline];
