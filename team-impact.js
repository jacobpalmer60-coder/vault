/* Pure, side-neutral before/after impact summaries for Vault trades.
 * This is a description of engine-computed facts, NOT a new price model.
 * Both sides are evaluated from their own point of view, using the same math.
 * Draft capital uses CURRENT pick prices, not promised rookie outcomes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VaultTradeImpact = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const val = n => Number.isFinite(Number(n)) ? Number(n) : 0;
  const sum = list => (list || []).reduce((s, p) => s + Math.max(0, val(p.value)), 0);
  const pickKey = p => [p.season, p.round, p.original].join('-');
  const pieces = list => ({
    players: (list || []).filter(a => a && a.type === 'player').length,
    picks: (list || []).filter(a => a && a.type === 'pick').length,
    playerValue: sum((list || []).filter(a => a && a.type === 'player')),
    pickValue: sum((list || []).filter(a => a && a.type === 'pick'))
  });
  function side(before, after, incoming, outgoing) {
    if (!before || !after) throw Error('Trade impact requires real before/after team snapshots');
    const incomingParts = pieces(incoming), outgoingParts = pieces(outgoing);
    const delta = (key) => val(after[key]) - val(before[key]);
    const beforePicks = (before.picks || []).map(pickKey);
    const afterPicks = (after.picks || []).map(pickKey);
    const beforeSet = new Set(beforePicks), afterSet = new Set(afterPicks);
    return {
      rosterId: before.rosterId,
      teamName: before.teamName,
      incoming: incomingParts,
      outgoing: outgoingParts,
      before: { playerValue: val(before.total), pickValue: val(before.picksValue), overall: val(before.overall), lineupPpg: val(before.opt), depth: (before.plist || []).length, pickCount: beforePicks.length },
      after: { playerValue: val(after.total), pickValue: val(after.picksValue), overall: val(after.overall), lineupPpg: val(after.opt), depth: (after.plist || []).length, pickCount: afterPicks.length },
      change: {
        playerValue: delta('total'), pickValue: delta('picksValue'), overall: delta('overall'),
        lineupPpg: delta('opt'), playerCount: (after.plist || []).length - (before.plist || []).length,
        pickCount: afterPicks.length - beforePicks.length
      },
      picksAdded: afterPicks.filter(k => !beforeSet.has(k)),
      picksRemoved: beforePicks.filter(k => !afterSet.has(k))
    };
  }
  // Describe effects, not whether a manager should accept an offer.
  // Never imply a price change is a guaranteed win or future pick outcome.
  function explain(impact, mode) {
    const d=impact.change, phrases=[];
    const pp=Math.abs(d.lineupPpg).toFixed(1);
    if (d.lineupPpg >= 0.5) phrases.push('adds '+pp+' projected starting-lineup points per week');
    else if (d.lineupPpg <= -0.5) phrases.push('gives up '+pp+' projected starting-lineup points per week');
    else phrases.push('has little effect on projected starting-lineup points');
    if (d.pickValue > 0) phrases.push('adds '+Math.round(d.pickValue).toLocaleString('en-US')+' in current draft-pick value');
    else if (d.pickValue < 0) phrases.push('spends '+Math.round(-d.pickValue).toLocaleString('en-US')+' in current draft-pick value');
    if (d.playerValue > 0) phrases.push('gains '+Math.round(d.playerValue).toLocaleString('en-US')+' in current player value');
    else if (d.playerValue < 0) phrases.push('loses '+Math.round(-d.playerValue).toLocaleString('en-US')+' in current player value');
    if (mode === 'rebuild') phrases.push('evaluate future assets and timeline separately from this season’s points');
    if (mode === 'contend') phrases.push('check whether the immediate lineup effect justifies any draft capital spent');
    return phrases;
  }
  function pair(before, after, givenA, givenB) {
    return {
      A: side(before.A, after.A, givenB, givenA),
      B: side(before.B, after.B, givenA, givenB)
    };
  }
  // One explanation contract for calculator and Coach. Market price and team
  // fit are distinct signals; this never changes the underlying grade.
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const delta=(before,after,key)=>finite(before?.[key])&&finite(after?.[key])?after[key]-before[key]:null;
  const modes={contend:'Contending',rebuild:'Rebuilding',retool:'Retooling',neutral:'Flexible',balance:'Flexible'};
  function assessment(analysis,giveA,giveB,{fitThreshold=2,marketAvailable=true,overpayThreshold=40}={}) {
    if(!analysis?.before||!analysis?.after||!giveA?.length||!giveB?.length)return null;
    const priced=[...giveA,...giveB].every(a=>finite(a.value)&&a.value>0);
    const result={basis:marketAvailable?'Vault market price':'KTC fallback price',marketAvailable,priced,teams:{}};
    for(const key of ['A','B']){
      const bef=analysis.before[key],aft=analysis.after[key],res=analysis['res'+key];
      if(!bef||!aft||!res)return null;
      const incoming=key==='A'?giveB:giveA,outgoing=key==='A'?giveA:giveB;
      const price=priced&&finite(analysis['dValueAdj'+key])?analysis['dValueAdj'+key]:null;
      const pct=price===null||!finite(analysis.pctDiff)?null:Math.sign(price)*Math.abs(analysis.pctDiff);
      const lineup=delta(bef,aft,'opt'),picks=delta(bef,aft,'picksValue'),age=delta(bef,aft,'age');
      const fit=finite(res.fit)?res.fit>=fitThreshold?'strong':res.fit<=-fitThreshold?'poor':'mixed':'unknown';
      const notes=[],risks=[];
      const fmt=(n,d=0)=>Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
      if(lineup!==null&&Math.abs(lineup)>=.05)(lineup>0?notes:risks).push((lineup>0?'Adds ':'Loses ')+fmt(lineup,1)+' projected starting-lineup points per week');
      if(picks!==null&&Math.abs(picks)>=.5)(picks>0?notes:risks).push((picks>0?'Adds ':'Spends ')+fmt(picks)+' in current draft capital');
      if(age!==null&&Math.abs(age)>=.1)(age<0?notes:risks).push('Roster becomes '+fmt(age,1)+' years '+(age<0?'younger':'older'));
      if(finite(res.dDepth)&&Math.abs(res.dDepth)>=.05)(res.depthFit<0?risks:notes).push('Estimated depth effect: '+(res.dDepth>0?'+':'−')+fmt(res.dDepth,1)+' PPG (see full breakdown)');
      if(res.mode==='contend'&&lineup!==null&&lineup<-.05)risks.push('Immediate production falls during a contending plan');
      if(res.mode==='rebuild'&&picks!==null&&picks<-.5)risks.push('Future draft flexibility falls during a rebuilding plan');
      let headline=fit==='strong'?'Strong strategic fit':fit==='poor'?'Poor strategic fit':fit==='mixed'?'Mixed strategic fit':'Strategic fit unavailable';
      if(pct!==null&&pct< -overpayThreshold&&fit==='strong')headline='Strong fit, substantial market overpay';
      else if(pct!==null&&pct< -1&&fit==='strong')headline='Strong fit, at a market cost';
      else if(pct!==null&&pct>1&&fit==='poor')headline='Market gain, but poor strategic fit';
      result.teams[key]={name:bef.teamName,mode:modes[res.mode]||'Flexible / unclassified',fit,headline,price,pct,lineup,picks,age,notes,risks,
        incomingCount:incoming.length,outgoingCount:outgoing.length,
        assumptions:['Roster direction is an inferred or user-selected plan, not confirmed manager intent.','Lineup points and depth are projections; pick value is current, not a future rookie forecast.','Strategic fit uses existing heuristic rules, not a validated championship prediction.']};
    }
    return result;
  }
  return Object.freeze({side, pair, pieces, explain, assessment});
});
