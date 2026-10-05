// @ts-nocheck - verbatim
/* Reading the embedded element-set catalogue: three lines per spacecraft.
 *
 * Moved VERBATIM from legacy/index.html (main@4eadd7a), lines 8492-8502. The arithmetic, its order
 * and the comments are untouched: the regression gate compares 67,488 values with ===, so this file
 * is not the place to tidy. What changed is only where the names come from. The page's closures over
 * BODY, OBS, MASK and satellite.js are now the arguments of makeEngine(), and the observer is a value
 * the caller replaces (a new engine) rather than an object mutated in place.
 */
export interface CatalogueEntry { name: string; l1: string; l2: string; satnum: string }

export function parseCatalog(txt: string): CatalogueEntry[] {
  const lines = txt.split(/\r?\n/).map(s=>s.replace(/\s+$/,'')).filter(s=>s.length);
  const out = [];
  for(let i=0;i<lines.length-2;i++){
    if(lines[i+1][0]==='1' && lines[i+2][0]==='2' && lines[i][0]!=='1' && lines[i][0]!=='2'){
      out.push({name:lines[i].trim(), l1:lines[i+1], l2:lines[i+2],
                satnum:lines[i+1].substring(2,7).trim()}); i+=2;
    }
  }
  return out;
}
