'use strict';
// Training must use only outcomes that had already been observed when the
// prediction was made. Earlier origin year alone is NOT sufficient.
function fitAsOf(rows, predictionDate) {
 const buckets = new Map();
 let eligible=0, rejectedFuture=0, unknown=0;
 for (const r of rows) {
  if (!(r.outcomeDate < predictionDate)) { rejectedFuture++; continue; }
  if (r.v1 == null || !Number.isFinite(r.v1) || r.v1 < 0 || !(r.v0 > 0)) { unknown++; continue; }
  eligible++;
  for (const key of [r.format+'|'+r.pos+'|'+r.ageBand, r.format+'|'+r.pos]) {
   const b=buckets.get(key)||{n:0,num:0,den:0};
   b.n++; b.num+=Math.min(2,r.v1/r.v0)*r.v0; b.den+=r.v0;
   buckets.set(key,b);
  }
 }
 const factor = r => {
  const fine=buckets.get(r.format+'|'+r.pos+'|'+r.ageBand);
  const broad=buckets.get(r.format+'|'+r.pos);
  const b=fine&&fine.n>=20?fine:broad;
  return b?(b.num+100000)/(b.den+100000):1;
 };
 return {factor,eligible,rejectedFuture,unknown};
}
module.exports={fitAsOf};
