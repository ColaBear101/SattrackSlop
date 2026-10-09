
const H = require('./lib/harness');/*
 * Does verify-custom.js notice when a guard of index.html is taken away?
 *
 * A check that cannot fail is not a check. This removes ONE guard at a time from a copy of index.html
 * (written to the temp directory, served in place of the real one: the repository file is never
 * touched), runs verify-custom.js against the copy, and reports which named check died. A mutant
 * that every check lets through is a gap in the suite; fix the suite, not this list.
 *
 * Each mutation is one or more exact-text edits; an edit whose text is not found exactly once is
 * reported as ANCHOR MISSING and fails the run, so a refactor of index.html cannot quietly turn a
 * mutant into "no change, nothing died". The mutants come from design-integration's measured list
 * (what went wrong on the unguarded page), SPEC 7.7 and the amendments of 7.4; the [hidden] rules
 * and the sheet's inert set are checked by the planner-UI suite, not here.
 *
 * Mutants listed under `equivalent` are guards that nothing can reach (a second layer behind a first
 * one that is itself tested); they are run and expected to SURVIVE, and the reason is printed. A
 * survivor outside that list, or an "equivalent" one that dies, is a finding.
 *
 * Each mutant runs the groups that were written to catch it first (CUSTOM_GROUPS, fail-fast); only if
 * those pass is the whole suite run, so a real survivor costs a full run and a caught one a few
 * seconds.
 *
 *   node verification/verify-custom-mutants.js              all of them (about 25 minutes, 3 at a time)
 *   MUTANT_ONLY=m01,m31 node verification/verify-custom-mutants.js
 *   MUTANT_JOBS=2        how many run at once (each is a Chromium)
 *   MUTANT_DRY=1         only check that every anchor matches exactly once
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = fs.readFileSync(path.join(H.TARGETS.legacy, 'index.html'), 'utf8');
const JOBS = Math.max(1, +process.env.MUTANT_JOBS || 3);
const ONLY = process.env.MUTANT_ONLY ? new Set(process.env.MUTANT_ONLY.split(',')) : null;
const DRY = !!process.env.MUTANT_DRY;

// [id, what was taken away, [[exact text, replacement], ...], the groups meant to catch it]
const M = [
  // ---- the network: no request of any kind for a number that belongs to nobody
  ['m01', 'refreshTLE: the custom guard removed (fetchTLE\'s digit guard still holds)', [[`  if(entry.custom) return;\n  /* Pinned`, `  /* Pinned`]], [2]],
  ['m02', 'fetchTLE: the one-to-five-digit guard removed (refreshTLE\'s guard still holds)', [[`  if(!/^\\d{1,5}$/.test(String(satnum))) return null;\n`, ``]], [11]],
  ['m03', 'both network guards removed (refreshTLE and fetchTLE)', [[`  if(entry.custom) return;\n  /* Pinned`, `  /* Pinned`], [`  if(!/^\\d{1,5}$/.test(String(satnum))) return null;\n`, ``]], [2]],
  ['m04', 'runLife: the custom return removed', [[`if(entry.custom || my !== lifeReq) return;`, `if(my !== lifeReq) return;`]], [11]],
  ['m05', 'lifeOffer: the custom branch removed (a custom orbit goes down the history path)', [[`  if(entry.custom){ lifeCustom(entry); return; }     // before anything keyed on the number\n`, ``]], [2]],
  // ---- identity: a flag, never a number
  ['m06', 'stdMagOf: the custom guard removed', [[`  if(e.custom) return { mag: Number.isFinite(e.stdMag) ? e.stdMag : STD_MAG, known: false, via: null };\n`, ``]], [3]],
  ['m07', 'txFor: the custom guard removed (the number is looked up in the SatNOGS table)', [[`  if(entry && entry.custom)\n    return entry.dlHz > 0 ? [{ hz: entry.dlHz, mode: 'user', baud: 0, desc: 'entered in the planner', service: '' }] : [];\n`, ``]], [3]],
  ['m08', 'paintBrief: the custom guard removed (a custom orbit named like the default raises "Outside the brief")', [[`n.hidden = !!D.entry.custom || !OUT_OF_BRIEF.test(D.entry.name);`, `n.hidden = !OUT_OF_BRIEF.test(D.entry.name);`]], [3]],
  ['m09', 'load(): the failure path restores curIdx with CAT.indexOf', [[`if(D.entry !== entry){ curIdx = indexOf(D.entry); box.value = D.entry.name; }`, `if(D.entry !== entry){ curIdx = CAT.indexOf(D.entry); box.value = D.entry.name; }`]], [4]],
  ['m10', 'renderElements: the revolution count of a planned orbit printed as 0', [[`D.entry.custom ? 'n/a (planned)' : String(D.E.rev)`, `String(D.E.rev)`]], [2]],
  ['m11', 'paintWindow: "SGP4 drifts this far out" is a warning for a custom orbit', [[`note.classList.toggle('warn', far && !cust);`, `note.classList.toggle('warn', far);`]], [20]],
  ['m12', 'paintWindow: a custom orbit is told "SGP4 drifts this far out"', [[`(cust ? ' — M belongs to the epoch' : ' — SGP4 drifts this far out')`, `' — SGP4 drifts this far out'`]], [20]],
  // ---- provenance text
  ['m13', 'tleSource: the custom branch removed (the CSV says "embedded" or "fetched live")', [[`  if(e.custom) return CUSTOM_SOURCE;       // first: never "embedded", never "fetched live"\n`, ``]], [2]],
  ['m14', 'liveLine: the custom branch removed', [[`  if(D && D.entry.custom) return ['custom', `, `  if(false) return ['custom', `]], [2]],
  ['m15', 'paintAges: the custom branch removed', [[`  if(D.entry.custom){ paintAgesCustom(); return; }\n`, ``]], [2]],
  ['m16', 'paintAgesCustom: the age chip may go stale', [[`  chip.classList.remove('stale');\n`, ``]], [2]],
  ['m17', 'the source line keeps the catalogue wording for a custom orbit (#srcline, D31)', [[`sl.textContent = on ? 'Synthesized from your elements · not a real TLE' : sl.dataset.def;`, `sl.textContent = sl.dataset.def;`]], [2]],
  ['m18', 'the NORAD / COSPAR spans are not hidden for a custom orbit (D16)', [[`    hide(span, on);\n`, ``]], [2]],
  ['m19', 'the "Custom orbit · edit" chip is never shown', [[`  hide(byId('customchip'), !on);\n`, `  hide(byId('customchip'), true);\n`]], [2]],
  ['m20', 'the chip is never hidden again for a catalogue spacecraft', [[`  hide(byId('customchip'), !on);\n`, `  hide(byId('customchip'), false);\n`]], [1]],
  ['m21', 'the element-set buttons stay for a catalogue spacecraft once a custom orbit has been shown', [[`  hide(byId('tleactions'), !on);\n`, `  if(on) hide(byId('tleactions'), false);\n`]], [4]],
  ['m22', 'the custom note stays for a catalogue spacecraft once a custom orbit has been shown', [[`  hide(byId('customnote'), !on);\n`, `  if(on) hide(byId('customnote'), false);\n`]], [4]],
  // ---- exports
  ['m23', 'the CSV satellite column loses " (custom orbit)"', [[`r.custom ? r.sat + ' (custom orbit)' : r.sat`, `r.sat`]], [2]],
  ['m24', 'the ICS SUMMARY loses its "[custom orbit] " prefix', [[`esc((r.custom ? '[custom orbit] ' : '') + r.sat`, `esc(r.sat`]], [2]],
  ['m25', 'the ICS DESCRIPTION loses its "Hypothetical orbit" line', [[`,\n      r.custom ? 'Hypothetical orbit planned on the Ground Track Console: not a catalogue object, and no spacecraft is known to fly it' : null`, ``]], [2]],
  ['m26', 'the export file name has no "custom-" stem', [[`const exportStem = () => D.entry.custom ? 'custom-' + (slug(D.entry.name) || 'orbit') : slug(D.entry.name);`, `const exportStem = () => slug(D.entry.name);`]], [2]],
  ['m27', 'the export file name of an all-non-Latin name has no fallback (passes-custom--bangkok)', [[`'custom-' + (slug(D.entry.name) || 'orbit')`, `'custom-' + slug(D.entry.name)`]], [19]],
  // ---- storage
  ['m28', 'restoreCustoms trusts the stored record (no sanitizeStore)', [[`    const got = Planner.sanitizeStore(raw);\n`, `    const got = { why: null, items: (() => { try { return JSON.parse(raw).items || []; } catch(e){ return []; } })(), next: 1, dropped: 0 };\n`]], [5]],
  ['m29', 'restoreCustoms runs under ?tle=embedded', [[`  if(PINNED || !plannerOn()) return;  // the stored record`, `  if(!plannerOn()) return;  // the stored record`]], [7]],
  ['m30', 'a bare restoreCustoms() at boot, gated on Planner alone, with no catch (the first draft)', [[`if(plannerOn()){ try { restoreCustoms(); } catch(e){ console.error(e); } }`, `restoreCustoms();`], [`  if(PINNED || !plannerOn()) return;  // the stored record`, `  if(PINNED || !window.Planner) return;  // the stored record`], [`catch(e){ console.error(e); }     // a throw leaves the list as it is`, `catch(e){ throw e; }     // a throw leaves the list as it is`]], [15]],
  ['m31', 'mkCustom lets a planner fault out, and restoreCustoms does not catch it', [[`  } catch(e){ console.error(e); mkFault = true; return null; }`, `  } catch(e){ throw e; }`], [`catch(e){ console.error(e); }     // a throw leaves the list as it is`, `catch(e){ throw e; }     // a throw leaves the list as it is`], [`if(plannerOn()){ try { restoreCustoms(); } catch(e){ console.error(e); } }`, `restoreCustoms();`]], [15]],
  ['m32', 'a planner fault is taken for a bad record: the saved list is rewritten without it', [[`    if(bad && !mkFault) saveCustoms();`, `    if(bad) saveCustoms();`]], [15]],
  ['m33', 'the storage listener is registered without the plannerOn() gate', [[`if(plannerOn()) window.addEventListener('storage', e => {`, `window.addEventListener('storage', e => {`]], [15]],
  ['m34', 'the storage listener merges under ?tle=embedded', [[`    if(PINNED || e.key !== CUSTOM_KEY`, `    if(e.key !== CUSTOM_KEY`]], [7]],
  ['m35', 'an emptied list removes the key, and with it the counter', [[`if(!items.length && customNext <= 1) localStorage.removeItem`, `if(!items.length) localStorage.removeItem`]], [18]],
  ['m36', 'mkCustom ignores verifyTLE (a record SGP4 cannot start from is listed)', [[`    if(!v.ok){ mkCustom.why = v.errors.length ? v.errors[0] : null; return null; }\n`, ``]], [5]],
  // ---- state: one list, one index space
  ['m37', 'a custom orbit is pushed onto CAT as well', [[`  customNext = Math.max(customNext, n + 1);\n  let moved = false;`, `  customNext = Math.max(customNext, n + 1);\n  CAT.push(entry);\n  let moved = false;`]], [2]],
  ['m38', 'gt-customs-changed is never dispatched', [[`window.dispatchEvent(new CustomEvent('gt-customs-changed'));`, `/* never */`]], [14]],
  ['m39', 'the cap is off by one (a 13th orbit is kept)', [[`if(CUSTOM.length >= Planner.LIMITS.maxCustom)\n    return customFail('err.cap'`, `if(CUSTOM.length > Planner.LIMITS.maxCustom)\n    return customFail('err.cap'`]], [16]],
  ['m40', 'the counter is not stopped at 9999', [[`    if(n > 9999) return customFail('planner.full', 'This browser has used every orbit number; delete the saved orbits.');\n`, ``]], [18]],
  ['m41', 'a cid already in use is trusted (a duplicate number)', [[`&& !used.has(input.cid) ? input.cid : null`, `? input.cid : null`]], [17]],
  ['m42', 'a duplicate name among the reader\'s own is not numbered', [[`name: uniqueName(name), el: v.el`, `name: name, el: v.el`]], [17]],
  ['m43', 'a refused Add keeps the counter it took', [[`customNext = prevNext; `, ``]], [16]],
  ['m44', 'an Add loads as a real load, not a trial (a refusal writes the console\'s #loadnote)', [[`    if(!load(entry, true)){           // load() has put`, `    if(!load(entry)){           // load() has put`]], [16]],
  ['m45', 'a successful Add leaves an older console note on screen', [[`    loadNote('');\n  } else if(D) curIdx`, `  } else if(D) curIdx`]], [17]],
  ['m46', 'show:false does not recompute curIdx after the splice', [[`  } else if(D) curIdx = indexOf(D.entry);       // the splice may have moved the one on screen`, `  }`]], [17]],
  ['m47', 'removing an orbit off screen leaves a stale curIdx', [[`  curIdx = indexOf(D.entry);          // virtual indices above k moved down by one\n`, ``]], [4]],
  ['m48', 'an edit of the orbit on screen drops the reader\'s instant on the clock', [[`if(!moved) setSim(keep, !was);`, ``]], [10]],
  ['m49', 'an edit of an orbit off screen is not tried before it is stored', [[`    try { compute(next, t0, spanH); }\n    catch(err){ return { ok: false, errors: [sgp4Refusal(next, err && typeof err === 'object' && 'sgp4' in err ? err.sgp4 : null)] }; }\n`, ``]], [10]],
  ['m50', 'a refused edit does not put the old elements back', [[`      take(entry, held);\n`, ``]], [10]],
  ['m51', 'the last catalogue spacecraft is not remembered (removing the orbit on screen goes to the default)', [[`  if(!entry.custom) lastCat = CAT.indexOf(entry);`, `  /* lastCat dropped */`]], [4]],
  // ---- the deep-space window (D39)
  ['m52', 'deepGuard does nothing (the window never moves to a deep-space orbit\'s epoch)', [[`function deepGuard(entry){\n`, `function deepGuard(entry){\n  return false;\n`]], [21]],
  ['m53', 'load() does not call deepGuard (a choice from the picker)', [[`  if(entry.custom && (!D || D.entry !== entry)) deepGuard(entry);\n`, ``]], [21]],
  ['m54', 'updateCustom does not call deepGuard', [[`    moved = deepGuard(entry);\n    if(!load(entry, true)){           // the old`, `    moved = false;\n    if(!load(entry, true)){           // the old`]], [21]],
  ['m55', 'the trial pass does not skip a deep-space orbit far from the window', [[`      if(entry.el && Planner.isDeep(entry.el.a) && Math.abs(t0 - entry.el.epoch) > Planner.LIMITS.deepTrialDays*864e5) return null;\n`, ``]], [21]],
  // ---- the picker
  ['m56', 'the picker finds a custom orbit by its placeholder number', [[`'custom'.startsWith(q)) cStarts.push`, `'custom'.startsWith(q) || CUSTOM[k].satnum.toLowerCase().startsWith(q)) cStarts.push`]], [4]],
  ['m57', 'the picker writes its group rows for a typed query too', [[`const groups = !q.trim() && CUSTOM.length > 0;`, `const groups = CUSTOM.length > 0;`]], [23]],
  ['m58', 'the picker always offers the Plan row (even with the planner off)', [[`  const plan = planOn();`, `  const plan = true;`]], [23]],
  ['m59', 'closeList restores the picker from CAT[curIdx]', [[`if(restore) box.value = entryAt(curIdx).name;`, `if(restore) box.value = CAT[curIdx].name;`]], [4]],
  ['m60', 'choose() loads CAT[idx]', [[`  stop(); load(entryAt(idx));`, `  stop(); load(CAT[idx]);`]], [4]],
  ['m61', 'indexOf is blind to the custom list', [[`i = CUSTOM.indexOf(e); return i >= 0 ? CAT.length + i : -1; };`, `return -1; };`]], [2]],
  ['m62', 'siteChanged reloads CAT[curIdx]', [[`  load(entryAt(curIdx));        // the whole analysis is site-dependent`, `  load(CAT[curIdx]);        // the whole analysis is site-dependent`]], [20]],
  ['m63', 'setWindow reloads CAT[curIdx]', [[`function setWindow(ms){ winStart = ms; stop(); load(entryAt(curIdx)); }`, `function setWindow(ms){ winStart = ms; stop(); load(CAT[curIdx]); }`]], [20]],
  ['m64', 'rollWindow reloads CAT[curIdx]', [[`  if(!load(entryAt(curIdx))){`, `  if(!load(CAT[curIdx])){`]], [20]],
  ['m65', 'the span buttons reload CAT[curIdx]', [[`spanH = +b.dataset.h; stop(); load(entryAt(curIdx));`, `spanH = +b.dataset.h; stop(); load(CAT[curIdx]);`]], [4]],
  ['m66', 'the count keeps the old " — type to search" suffix (the pill wraps, D15)', [[`CUSTOM.length + ' of yours' : ' spacecraft');`, `CUSTOM.length + ' of yours' : ' spacecraft — type to search');`]], [1]],
  // ---- the Decay section
  ['m67', 'the custom Decay chart labels its x axis with calendar months', [[`g.fillText(cust ? (i === 0 ? 'epoch' : '+' + lifeAxis((t - t0)/86400000)) : iso(new Date(t)).slice(0,7), X(t), Hc-B+7);`, `g.fillText(iso(new Date(t)).slice(0,7), X(t), Hc-B+7);`]], [9]],
  ['m68', 'the custom Decay axis ends with the mid-case run (the x1/3 run is clipped)', [[`cust ? r.tNow + (Math.max(lastT(r.track), lastT(r.simpleTrack), lastT(r.trendTrack)) || 1)*86400000`, `cust ? r.tNow + (lastT(r.track) || 1)*86400000`]], [9]],
  ['m69', 'the custom Decay tooltip prints a date', [[`    tip.innerHTML = lifeState.custom\n`, `    tip.innerHTML = false\n`]], [9]],
  ['m70', 'the custom Decay legend says "observed (N element sets)"', [[`  if(cust){\n    /* the stock legend says`, `  if(false){\n    /* the stock legend says`]], [2]],
  // ---- what the planner is handed
  ['m71', 'load() never calls PlannerUI.onLoad', [[`  if(window.PlannerUI && PlannerUI.onLoad){ try { PlannerUI.onLoad(D); } catch(e){ console.error(e); } }\n`, ``]], [24]],
  ['m72', 'load() calls PlannerUI.onLoad without a try (a planner fault fails the load)', [[`try { PlannerUI.onLoad(D); } catch(e){ console.error(e); }`, `PlannerUI.onLoad(D);`]], [24]],
  ['m73', 'PlannerUI.init is not called under ?tle=embedded (the pill never says why)', [[`if(plannerOn()){ try { PlannerUI.init(plannerHost); }`, `if(plannerOn() && !PINNED){ try { PlannerUI.init(plannerHost); }`]], [7]],
  ['m74', 'host.window() reports the clock, not the window on screen', [[`window: () => ({ startMs: winStart === null ? Date.now() : winStart, hours: spanH }),`, `window: () => ({ startMs: Date.now(), hours: spanH }),`]], [22]],
  ['m75', 'host.obs() hands out a copy of the observer, not the live one', [[`obs: () => OBS, mask: MASK,`, `obs: () => Object.assign({}, OBS), mask: MASK,`]], [22]],
  ['m76', 'host.show() shows nothing', [[`  show: e => choose(indexOf(e)),`, `  show: e => {},`]], [22]],
  ['m77', 'host.storageOk() is always true', [[`storageOk: () => lastSaveOk,`, `storageOk: () => true,`]], [22]],
  ['m78', 'host.tracked() says a custom orbit is tracked', [[`tracked: e => !e.custom,`, `tracked: e => true,`]], [22]],
  ['m79', 'host.mask is a string (PlannerUI.init refuses a host it cannot use, and the planner never comes up)', [[`obs: () => OBS, mask: MASK,`, `obs: () => OBS, mask: String(MASK),`]], [1]]
];
// Guards that nothing can reach: each sits behind another layer that IS tested. Expected to survive.
const EQUIVALENT = [
  ['e1', 'tickAges reads CAT[curIdx] (a custom orbit is then never handed to refreshTLE by the 30 s beat; load() already did, and the guard returns first)', [[`  const entry = entryAt(curIdx);\n  if(entry) refreshTLE(entry);`, `  const entry = CAT[curIdx];\n  if(entry) refreshTLE(entry);`]], null],
  ['e2', 'saveCustoms has no PINNED guard (addCustom, updateCustom and removeCustom refuse first under ?tle=embedded, restoreCustoms and the storage listener return first: nothing calls it)', [[`  if(PINNED) return true;             // the assignment snapshot neither reads nor writes\n`, ``]], null],
  ['e3', 'updateCustom does not clear entry.__life (the memo is keyed on a, e, i and am, every input the forecast reads: the key is the second layer)', [[`    take(entry, next); entry.__life = null;\n    moved = deepGuard(entry);`, `    take(entry, next);\n    moved = deepGuard(entry);`]], null]
];

function build(edits) {
  let out = BASE;
  for (const [from, to] of edits) {
    const n = out.split(from).length - 1;
    if (n !== 1) return { error: 'ANCHOR ' + (n ? 'AMBIGUOUS (' + n + ')' : 'MISSING') + ': ' + JSON.stringify(from.slice(0, 70)) };
    out = out.replace(from, () => to);
  }
  return { html: out };
}

function run(id, html, groups, failfast) {
  return new Promise(resolve => {
    const file = path.join(os.tmpdir(), 'gt-mutant-' + process.pid + '-' + id + '.html');
    fs.writeFileSync(file, html);
    const env = Object.assign({}, process.env, { CUSTOM_INDEX_HTML: file, CUSTOM_FAILFAST: failfast ? '1' : '' });
    if (groups) env.CUSTOM_GROUPS = groups.join(','); else delete env.CUSTOM_GROUPS;
    const child = cp.spawn(process.execPath, [path.join(__dirname, 'verify-custom.js')], { env, cwd: ROOT });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill(), 25 * 60 * 1000);
    child.on('close', code => {
      clearTimeout(timer);
      try { fs.unlinkSync(file); } catch (e) { /* gone */ }
      const first = (out.match(/FIRST FAILURE \(CUSTOM_FAILFAST\): (.*)/) || [])[1]
        || (out.match(/^  FAIL  (.*)$/m) || [])[1] || null;
      const crashed = /SUITE CRASHED: (.*)/.exec(out);
      resolve({ code, first, crashed: crashed ? crashed[1].slice(0, 160) : null, out, pageErrors: /PAGE ERRORS: (\d+)/.exec(out) });
    });
  });
}

async function one(m, equivalent) {
  const [id, what, edits, groups] = m;
  const b = build(edits);
  if (b.error) return { id, what, status: 'ANCHOR', detail: b.error };
  if (DRY) return { id, what, status: 'ANCHOR OK', detail: '' };
  /* a page that would not even load within the time (three Chromiums at once) says nothing about the guard: run it again */
  const settle = async (g, ff) => { let r = await run(id, b.html, g, ff); for (let k = 0; k < 2 && r.crashed && /page.goto/.test(r.crashed); k++) r = await run(id, b.html, g, ff); return r; };
  let r = null;
  if (groups) { r = await settle(groups, true); if (r.code !== 0) return { id, what, status: 'CAUGHT', detail: describe(r, groups) }; }
  r = await settle(null, true);
  if (r.code !== 0) return { id, what, status: 'CAUGHT', detail: describe(r, null) + (groups ? ' (NOT by the groups meant for it: ' + groups.join(',') + ')' : '') };
  return { id, what, status: equivalent ? 'SURVIVED (equivalent)' : 'SURVIVED', detail: 'the whole suite passed' };
}
function describe(r, groups) {
  if (r.crashed) return 'the suite crashed: ' + r.crashed;
  if (r.first) return 'died: ' + r.first.slice(0, 190);
  if (r.pageErrors) return 'page errors: ' + r.pageErrors[1];
  return 'exit ' + r.code;
}

(async () => {
  const list = M.map(m => [m, false]).concat(EQUIVALENT.map(m => [m, true])).filter(([m]) => !ONLY || ONLY.has(m[0]));
  const results = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const [m, eq] = list[next++];
      const r = await one(m, eq);
      results.push(r);
      console.log((r.status === 'CAUGHT' || r.status === 'ANCHOR OK' ? '  ' : '  !! ') + r.status.padEnd(21) + r.id + '  ' + r.what + '\n' + ''.padEnd(26) + r.detail);
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, list.length) }, worker));
  const by = s => results.filter(r => r.status === s).length;
  const bad = results.filter(r => r.status === 'SURVIVED' || r.status === 'ANCHOR' || (r.status === 'CAUGHT' && /^e\d/.test(r.id)));
  console.log('\n' + results.length + ' mutants: ' + by('CAUGHT') + ' caught, ' + by('SURVIVED') + ' survived, ' + by('SURVIVED (equivalent)') + ' equivalent survived, ' + by('ANCHOR') + ' with a missing anchor' + (DRY ? ', ' + by('ANCHOR OK') + ' anchors ok' : ''));
  if (bad.length) { console.log('FINDINGS: ' + bad.map(r => r.id + ' (' + r.status + ')').join(', ')); process.exit(1); }
  console.log(DRY ? 'ALL ANCHORS MATCH' : 'EVERY MUTANT CAUGHT (the equivalent ones survived, as listed)');
})();
