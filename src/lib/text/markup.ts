import { b, br, type Inline } from './rich';

/* The old page wrote some of its prose as strings of inline HTML - a bold phrase, a line break, a typographic entity - and
 * assigned them with innerHTML. The sentences are long and the wording is the point, so they are moved as they were written;
 * this reads such a string into the data of rich.ts. Only <b>, </b> and <br> are understood; any other "<" is text, so a
 * string that carries something else (a name, a reply from a source) can never become an element. Entities are decoded as
 * text. */

const ENTITIES: Record<string, string> = {
  '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“', '&mdash;': '—', '&ndash;': '–', '&nbsp;': ' ',
  '&times;': '×', '&deg;': '°', '&plusmn;': '±', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
};
const decode = (s: string): string => s.replace(/&(?:[a-z]+|#\d+);/gi, m => ENTITIES[m] ?? m);

export function markup(src: string): Inline {
  const root: Inline[] = [];
  const stack: Inline[][] = [root];
  const top = () => stack[stack.length - 1]!;
  const tag = /<b>|<\/b>|<br>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = tag.exec(src))) {
    if (m.index > last) top().push(decode(src.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[0] === '<br>') top().push(br);
    else if (m[0] === '<b>') { const inner: Inline[] = []; top().push(b(inner)); stack.push(inner); }
    else if (stack.length > 1) stack.pop();             // a stray </b> is ignored
  }
  if (last < src.length) top().push(decode(src.slice(last)));
  return root.length === 1 ? root[0]! : root;
}
