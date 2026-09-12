const fs=require('fs');
const {parseTLE}=require('./core.js');
const GT=require('./propagate.js');
const sat=require('./satellite.min.js');
const L=fs.readFileSync(require('path').join(__dirname,'resource.txt'),'utf8').replace(/\r/g,'').split('\n');
const i=L.findIndex(l=>l.trim()==='LANDSAT 9');
const name=L[i].trim(), l1=L[i+1], l2=L[i+2];
const E=parseTLE(l1,l2), rec=sat.twoline2satrec(l1,l2);
const pad=(x,n=2)=>String(x).padStart(n,'0');
const hms=d=>pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(Math.floor(d.getUTCSeconds()));
console.log(name,'| NORAD',E.satnum,'| COSPAR',E.intl);
console.log('epoch UTC :',E.epoch.toISOString());
console.log('a  =',E.a.toFixed(3),'km   e =',E.ecc.toFixed(7),'  i =',E.inc.toFixed(4),'deg');
console.log('RAAN =',E.raan.toFixed(4),'deg   argp =',E.argp.toFixed(4),'deg   M =',E.ma.toFixed(4),'deg');
console.log('n =',E.n,'rev/day | period =',(E.period/60).toFixed(2),'min | alt',E.perigeeAlt.toFixed(1),'-',E.apogeeAlt.toFixed(1),'km');
const P=GT.findPasses(rec,E.epoch,24,GT.BANGKOK,5,10);
let tot=0;
console.log('\n #  AOS(UTC)  LOS(UTC)   dur      maxEl   az@max  minRange');
P.forEach((p,k)=>{tot+=p.durationS;
  console.log(' '+(k+1)+'  '+hms(p.aos)+'  '+hms(p.los)+'  '+p.durationS.toFixed(1).padStart(6)+'s  '+
    p.maxEl.toFixed(2).padStart(6)+'  '+p.maxElAz.toFixed(0).padStart(5)+'   '+p.minRange.toFixed(0)+' km');});
console.log('\nTOTAL VISIBLE =',tot.toFixed(1),'s =',(tot/60).toFixed(2),'min  over',P.length,'passes',
            '=',(tot/864).toFixed(3),'% of the day');
