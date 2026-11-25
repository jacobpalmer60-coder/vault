'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
function validate(d){
  assert.equal(d.kind,'research-price-separation');assert.equal(d.horizonDays,365);
  assert.equal(d.sampleMod,100);assert.equal(d.filters.playerOnlyOneForTwo,true);
  assert.ok(['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'].includes(d.filters.format));
  const c=d.counts;for(const k of ['sampled','priced','mature','complete','missing'])assert.ok(Number.isSafeInteger(c[k])&&c[k]>=0,k);
  assert.ok(c.sampled>=c.priced&&c.priced>=c.mature&&c.mature===c.complete+c.missing);
  const a=d.all;assert.equal(a.eligible,c.complete);assert.equal(a.decisive+a.zeroSignal,a.eligible);
  for(const k of ['0','0.1','0.25','0.5','0.75','1']){
    const r=a.weights[k];assert.ok(r);for(const v of [r.right,r.wrong,r.tie])assert.ok(Number.isSafeInteger(v)&&v>=0);
    assert.equal(r.right+r.wrong+r.tie,a.decisive);if(a.decisive)assert.equal(r.accuracyPct,+(100*r.right/a.decisive).toFixed(2));else assert.equal(r.accuracyPct,null);
  }
  return '### '+d.filters.format+' — retrospective, not sealed holdout\n'+c.complete+' complete outcomes; '+a.decisive+' decisive. Additive: '+(a.weights['0'].accuracyPct??'not measured')+'%; consolidation: '+(a.weights['1'].accuracyPct??'not measured')+'%. No live weight changes. Small or zero cohorts are not conclusive.';
}
if(require.main===module)console.log(validate(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))));
module.exports={validate};
