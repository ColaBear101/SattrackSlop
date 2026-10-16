/* The words of the picker's other names (CHANGES-FROM-LEGACY.md, L61): a row that a search found by another name of the spacecraft,
 * SatNOGS DB's (data/aliases.json), says which one, in plain text inside the option after the catalogue's name.
 *
 * New in the rebuild; the old page searched the catalogue's names alone. A module of its own: it travels with the alias chunk
 * (lib/catalogue/alias.ts), asked for the first time something is typed, not with the picker in the entry. */

/** in the option, after the name: which other name of the spacecraft the search matched ("matches RS-44") */
export const aliasSaid = (name: string): string => 'matches ' + name;
