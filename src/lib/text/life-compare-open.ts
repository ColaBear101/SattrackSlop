/* The words of the Decay section's opener of the comparison (CHANGES-FROM-LEGACY.md, L66): the disclosure button under the chart, and
 * the sentence beside it when the comparison's own chunk could not be fetched.
 *
 * New in the rebuild. These two travel with the report's chunk (Report), where the button is; every other word of the comparison is
 * in life-compare.ts, which travels with the comparison's own chunk (DecayCompare), asked for at the first press of this button (or
 * when the section comes near, if the panel was left open). The comparison's chunk must not import this module: anything it took
 * from the report's chunk would have to be exported from it. */

/** the disclosure button; its name stays the same open or shut, and aria-expanded says which */
export const CMP_OPEN = 'Compare with other spacecraft';

/** beside the button, when the comparison's chunk did not arrive; the button stays pressable */
export const CMP_OPEN_FAILED = 'The comparison could not be loaded, which usually means the connection went. Press again to retry.';
