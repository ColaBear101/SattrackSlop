/* report.js - the LANDSAT 9 answer, printed the way the page computes it.
 *
 * It used to print core.js's mean-element algebra: a = (mu/n^2)^(1/3) on the
 * Kozai mean motion, the period as 86400/n and the altitudes as a(1-+e) - Re.
 * The README calls all three wrong and the page shows none of them, so the
 * documented command for "the answer" disagreed with the answer by 2.9 km in a
 * and about 25 km in altitude. Now it prints what the page prints:
 *
 *   - a: SGP4's recovered Brouwer value, through the same core/propagator.js
 *     accessor the page reads, on WGS-72;
 *   - the nodal period: measured node to node, northbound geodetic-latitude
 *     zero crossings scanned at 20 s and bisected to 1 ms, as compute() does;
 *   - the altitudes: geodetic heights on WGS-84, propagated over that
 *     revolution at compute()'s own sampling density.
 *
 * All three are measured from the element set's epoch, which is where the
 * README's figures come from. The page measures them from the start of its
 * analysis window, which defaults to now, so it drifts from these slightly as
 * that window moves.
 *
 * The naive values are still printed, labelled as such, because the gap
 * between them is part of the answer.
 */
const fs=require('fs');
const path=require('path');
const {parseTLE}=require('./core.js');
const GT=require('./propagate.js');
const sat=require('./satellite.min.js');
require(path.join(__dirname,'..','core/body.js'));
require(path.join(__dirname,'..','core/propagator.js'));
const {Body,Propagator}=globalThis;

const L=fs.readFileSync(path.join(__dirname,'resource.txt'),'utf8').replace(/\r/g,'').split('\n');
const i=L.findIndex(l=>l.trim()==='LANDSAT 9');
const name=L[i].trim(), l1=L[i+1], l2=L[i+2];
const E=parseTLE(l1,l2), rec=sat.twoline2satrec(l1,l2);
const track=Propagator.sgp4Track(Body.Earth(sat),{name,l1,l2},sat);
const pad=(x,n=2)=>String(x).padStart(n,'0');
const hms=d=>pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(Math.floor(d.getUTCSeconds()));

/* compute()'s two measurements, from the epoch. Same scan, same bisection,
   same sample count; only the starting instant is the epoch rather than a
   window start. */
const t0=E.epoch.getTime();
const geo=ms=>{ const s=track.at(ms); if(!s) return null;
  return track.body.toGeodetic(s.r, track.body.spin(new Date(ms))); };
const lat=ms=>{ const g=geo(ms); return g ? g.latitude : null; };
const hits=[];
let prev=lat(t0);
for(let t=t0+20000; t<t0+E.period*2200 && hits.length<2; t+=20000){
  const cur=lat(t);
  if(prev!==null && cur!==null && prev<0 && cur>=0){
    let lo=t-20000, hi=t, flo=prev;
    for(let k=0;k<40 && hi-lo>1;k++){
      const mid=(lo+hi)/2, fm=lat(mid);
      if(fm===null) break;
      if((flo<0)===(fm<0)){ lo=mid; flo=fm; } else hi=mid;
    }
    hits.push((lo+hi)/2);
  }
  prev=cur;
}
const P=hits.length===2 ? (hits[1]-hits[0])/1000 : E.period;
let hLo=Infinity, hHi=-Infinity;
const N2=Math.round(720+3000*Math.min(0.95,E.ecc));
for(let k=0;k<=N2;k++){
  const g=geo(t0+k*P*1000/N2);
  if(!g) continue;
  if(g.height<hLo) hLo=g.height; if(g.height>hHi) hHi=g.height;
}

console.log(name,'| NORAD',E.satnum,'| COSPAR',E.intl);
console.log('epoch UTC :',E.epoch.toISOString());
console.log('a  =',track.recoveredA.toFixed(3),'km (SGP4 Brouwer, WGS-72)   e =',E.ecc.toFixed(7),'  i =',E.inc.toFixed(4),'deg');
console.log('RAAN =',E.raan.toFixed(4),'deg   argp =',E.argp.toFixed(4),'deg   M =',E.ma.toFixed(4),'deg');
console.log('n =',E.n,'rev/day (Kozai) | nodal period =',(P/60).toFixed(2),'min'+(hits.length===2?'':' (NOT measured: 86400/n)')+
            ' | alt',hLo.toFixed(1),'-',hHi.toFixed(1),'km over that revolution');
console.log('   naive mean-element algebra, NOT what the page shows: a = (mu/n^2)^(1/3) =',E.a.toFixed(3),
            'km, 86400/n =',(E.period/60).toFixed(2),'min, a(1-+e) - Re =',E.perigeeAlt.toFixed(1),'-',E.apogeeAlt.toFixed(1),'km');
const P2=GT.findPasses(rec,E.epoch,24,GT.BANGKOK,5,10);
let tot=0;
console.log('\n #  AOS(UTC)  LOS(UTC)   dur      maxEl   az@max  minRange');
P2.forEach((p,k)=>{tot+=p.durationS;
  console.log(' '+(k+1)+'  '+hms(p.aos)+'  '+hms(p.los)+'  '+p.durationS.toFixed(1).padStart(6)+'s  '+
    p.maxEl.toFixed(2).padStart(6)+'  '+p.maxElAz.toFixed(0).padStart(5)+'   '+p.minRange.toFixed(0)+' km');});
console.log('\nTOTAL VISIBLE =',tot.toFixed(1),'s =',(tot/60).toFixed(2),'min  over',P2.length,'passes',
            '=',(tot/864).toFixed(3),'% of the day');
