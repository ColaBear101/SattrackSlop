/* Where the numbers on screen came from, said without implying they are fresher than they are.
 *
 * `liveLine`, the age chip and the two provenance blocks are moved from legacy/index.html (main@4eadd7a), lines
 * 12165-12255 (liveLine, paintAgesCustom, paintAges), with their comments and every word of their text. What the
 * page's closure supplied is arguments: the entry's provenance record, whether the lines on screen are the embedded
 * ones, the time, the epoch. What they wrote into the DOM with innerHTML they return as data (rich.ts), so a
 * spacecraft's name or a source's reply can never become markup.
 */
import { ago, iso } from './fmt';
import { b, br, link, plain, warn, type Inline } from './rich';

/** What the last check of an element set said. Which keys are present is what says it, as in the old page:
 *    { pinned }                      the assignment snapshot: nothing is ever asked
 *    { src: null }                   no source could be reached
 *    { src, at }                     confirmed current against src at `at`
 *    { src, at, updated }            a newer set was taken from src
 *    { gone, at }                    the source no longer carries the object
 *    { src: null, older }            the source offered an older set, which is refused
 *    { dead, at, code, why }         a newer set that SGP4 cannot propagate in this window, refused */
export interface Prov {
  pinned?: boolean; src?: string | null; at?: number; updated?: boolean; gone?: string; older?: string;
  dead?: string; code?: number | null; why?: string;
}

export type LiveState = 'custom' | 'checking' | 'snap' | 'live' | 'gone';

export interface LiveIn {
  /** the entry on screen is an orbit the reader designed */
  custom: boolean;
  /** the entry's provenance record, or null when it has not been checked yet */
  prov: Prov | null;
  /** the two lines on screen are the embedded ones (read off the lines, as tleSource does) */
  embedded: boolean;
  now: number;
}

/* One sentence, used in three places, so the page never disagrees with itself about where the numbers on screen
   came from. */
export function liveLine({ custom, prov, embedded, now }: LiveIn): [LiveState, Inline] {
  /* Read off the entry, not off the record: the line is painted inside load(), before the refresh has had a chance
     to record anything (and a refresh never records anything for a planned orbit). */
  if (custom) return ['custom', 'Custom orbit — built on this page from the elements you entered. There is no live source to check it against, and nothing was fetched.'];
  const tleLive = prov;
  if (!tleLive) return ['checking', 'Checking for a newer element set…'];
  if (tleLive.pinned) return ['snap', ['Assignment snapshot — the ', b('embedded'), ' element set, not refreshed.']];
  /* When the check happened, not merely that it happened. The page re-checks while it is open, so on a console
     left running "confirmed current" would otherwise read exactly the same after four hours as after four seconds
     - and the one outcome worth engineering against is the page implying the numbers are fresher than they are. */
  const since = now - (tleLive.at ?? 0);
  const seen: Inline = !tleLive.at ? ''
    : since < 45000 ? [' · checked ', b('just now')]
    : [' · checked ', b(ago(since)), ' ago'];
  if (tleLive.updated) return ['live', ['Updated live from ', b(tleLive.src!), seen, '.']];
  if (tleLive.src) return ['live', ['Confirmed current against ', b(tleLive.src), seen, '.']];
  if (tleLive.gone) return ['gone', [b(tleLive.gone), ' has no current elements for this object', seen, ' — it may have re-entered.']];
  if (tleLive.dead) return ['gone', [b(tleLive.dead), ' has a newer set that SGP4 cannot propagate in this window (', tleLive.why ?? '', ')', seen,
    ' — keeping the one on screen', tleLive.code === 6 ? '; the object may have re-entered.' : '.']];
  /* Which set is kept is read off the lines, as tleSource() does: once a newer set has been taken live, a later
     check that is offered an older one, or reaches nothing, leaves that set on screen, not the embedded one. */
  if (tleLive.older) return ['snap', [b(tleLive.older), ' offered an older set — keeping ',
    embedded ? 'the embedded one.' : 'the newer one on screen, fetched live earlier.']];
  return ['snap', ['No live source reachable — ',
    embedded ? 'showing the embedded snapshot.' : 'keeping the set on screen, fetched live earlier.']];
}

export interface Ages {
  /** the chip's text and whether it is flagged old, with its tooltip */
  chip: { text: string; stale: boolean; title: string };
  state: LiveState;
  /** the sentence saying where the numbers came from, with its emphasis; and without, for the compact block in the rail */
  line: Inline;
  linePlain: string;
  /** the rail's three lines: the epoch, then the sentence above (coloured by `state`), then the age */
  railHead: Inline;
  railTail: Inline;
  /** what follows the sentence in the paragraph under the element set */
  metaRest: Inline;
}

export interface AgesIn extends LiveIn {
  epoch: Date;
  name: string;
  satnum: string;
  /** when the embedded catalogue was downloaded, and where from */
  fetched: Date;
  source: string;
  pinned: boolean;
}

/* A planned orbit has no measured element set to age, so nothing here goes stale. The age is signed: ago() clamps at
   zero, so an epoch in the future (a window opened ahead of now) needs its own wording. */
function agesCustom(a: AgesIn, [, line]: [LiveState, Inline]): Ages {
  const d = a.epoch.getTime() - a.now;          // + is ahead of now
  const when = Math.abs(d) < 90000 ? 'epoch now' : d > 0 ? 'epoch in ' + ago(d) : 'epoch ' + ago(-d) + ' ago';
  return {
    chip: { text: 'custom orbit · ' + when, stale: false, title: 'A planned orbit: there is no measured element set to age, so nothing here goes stale.' },
    state: 'custom', line, linePlain: plain(line),
    railHead: ['Epoch ', b(iso(a.epoch).replace('Z', '')), br], railTail: [br, 'Custom orbit, your elements', br, when],
    metaRest: [br,
      'The two lines above are a synthetic element set written from your inputs so that SGP4 can run them. ',
      'Its catalogue number, ', b(a.satnum), ', is a placeholder: NORAD’s Alpha-5 numbering never uses the letter O, ',
      'so it cannot be mistaken for a real object.', br,
      'Epoch ', when.replace(/^epoch /, ''),
      '. A designed orbit has no measured truth behind it, so the drift SGP4 shows away from its epoch is the model’s own.']
  };
}

export function ages(a: AgesIn): Ages {
  const ll = liveLine(a);
  if (a.custom) return agesCustom(a, ll);
  const epochAgeMs = a.now - a.epoch.getTime();
  const stale = epochAgeMs > 3 * 86400000;
  const [lstate, ltext] = ll;
  const old: Inline = stale ? warn(ago(epochAgeMs) + ' old') : ago(epochAgeMs) + ' old';
  return {
    chip: {
      text: 'epoch ' + ago(epochAgeMs) + ' old', stale,
      title: stale ? 'This element set is over three days old; SGP4 accuracy degrades with age.' : 'Age of this element set relative to now.'
    },
    state: lstate, line: ltext, linePlain: plain(ltext),
    railHead: ['Epoch ', b(iso(a.epoch).replace('Z', '')), br], railTail: [br, 'Element set ', old],
    metaRest: [br,
      'Embedded snapshot built ', b(iso(a.fetched)), ' from ', a.source,
      ' — ', b(ago(a.now - a.fetched.getTime())), ' ago.', br,
      'This element set’s epoch is ', old,
      stale ? ' — accuracy degrades with age; re-fetch before quoting pass times.' : '.', br,
      a.pinned
        ? ['Pinned to the embedded sets, each window opening at its set’s epoch, as the README’s ' +
          'figures are computed. ', link('?', 'Back to the live element sets'), '.']
        : ['The README’s figures come from the embedded sets, each window opening at its set’s ' +
          'epoch: the ', link('?tle=embedded', 'assignment snapshot'), ' reproduces them.']]
  };
}
