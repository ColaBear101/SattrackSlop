/* The page's own credits: which version this is, the code's licence and where its source is, and the licence of the
 * data it carries from someone else.
 *
 * New in the rebuild (CHANGES-FROM-LEGACY.md, L49); the old page said none of it. The version is an argument, so this
 * layer stays free of globals: the component passes the one Vite writes in from package.json (`__APP_VERSION__`,
 * vite.config.ts). The downlink table, data/transmitters.json, is an adaptation of SatNOGS DB's transmitter list, which
 * Libre Space Foundation publishes under CC BY-SA 4.0: the licence asks for the credit, a link to the licence and the
 * same licence on what is made from it, so the line names all three and the README says which file it covers. */
import { link, type Inline } from './rich';

/** The repository. The cache API's OpenAPI page names the same one (server/config.ts, REPO_URL); a test holds them equal. */
export const REPO_URL = 'https://github.com/ColaBear101/SattrackSlop';
export const SATNOGS_DB_URL = 'https://db.satnogs.org/';
export const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

/** The footer's last line: Ground Track Console 1.0.0 · MIT licence · github.com/ColaBear101/SattrackSlop ·
 *  Transmitter data: SatNOGS DB, CC BY-SA 4.0 */
export function creditLine(version: string): Inline {
  return [
    'Ground Track Console ' + version + ' · MIT licence · ',
    link(REPO_URL, REPO_URL.replace(/^https:\/\//, '')),
    ' · Transmitter data: ', link(SATNOGS_DB_URL, 'SatNOGS DB'), ', ', link(CC_BY_SA_URL, 'CC BY-SA 4.0')
  ];
}
