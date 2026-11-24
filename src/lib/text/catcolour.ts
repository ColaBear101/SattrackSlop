/* The catalogue's colourings in the Layers panel (CHANGES-FROM-LEGACY.md, L76): the choices under the Catalogue switch, the name of
   their group, and what is said when the colours cannot be had. In the entry chunk with the rest of the panel, so kept to these; the
   classes' names, the key and the notes are catcolour-key.ts, in the colours' own chunk. */

/** the choices, the first the old page's one colour and the default */
export const CATCOL_CHOICES = [['one', 'One colour'], ['orbit', 'By orbit'], ['type', 'By type'], ['purpose', 'By purpose']] as const;

/** the group of choices, as a screen reader names it */
export const CATCOL_GROUP = 'Colour the catalogue';

export const CATCOL_FAILED = 'The colours could not be loaded, so the catalogue keeps one colour.';
