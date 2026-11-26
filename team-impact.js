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
  const modes={contend:'Contending',rebuild:'Rebuilding',retool:'Retooling',neutral:'Flexible',balance:'Flexible',flexible:'Flexible timeline'};
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
  function assessmentHtml(result,{only=null,compact=false}={}){
    if(!result)return '';
    const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num=(n,d=0)=>n===null?'Unavailable':(n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
    const metric=(label,value)=>`<div class="min-w-0"><div class="text-[12px] text-zinc-400">${label}</div><div class="text-[15px] font-medium tabular-nums text-zinc-100">${esc(value)}</div></div>`;
    const card=t=>`<section class="rounded-lg border border-white/10 p-3 min-w-0" aria-label="Strategic assessment for ${esc(t.name)}">
      ${only?'':`<div class="text-[13px] font-medium text-zinc-100 break-words">${esc(t.name)}</div>`}
      <div class="text-[12px] text-zinc-400">${esc(t.mode)}</div>
      <div class="text-[16px] font-semibold mt-1 ${t.fit==='strong'?'text-emerald-300':t.fit==='poor'?'text-amber-300':'text-zinc-200'}">${esc(t.headline)}</div>
      <div class="grid grid-cols-2 gap-3 mt-3">
       ${metric(result.basis,t.pct===null?'Unavailable':num(t.pct,1)+'%')}
       ${metric('Projected lineup PPG',num(t.lineup,1))}
       ${metric('Draft capital today',num(t.picks))}
       ${metric('Roster age change',t.age===null?'Unavailable':num(t.age,1)+' yr')}
      </div>
      <details class="mt-3 border-t border-white/10 pt-2"><summary class="cursor-pointer text-[13px] text-zinc-300">Why this fit? · changes and tradeoffs</summary>
       <div class="mt-2 space-y-2 text-[12px] leading-relaxed text-zinc-300">
        <p><strong class="text-zinc-100">Roster changes:</strong> ${esc(t.notes.join('; ')||'No material favorable-direction changes measured.')}</p>
        <p><strong class="text-zinc-100">Costs and tradeoffs:</strong> ${esc(t.risks.join('; ')||'No material adverse-direction changes measured; risk still remains.')}</p>
        <p class="text-zinc-400">${esc(t.assumptions.join(' '))}</p>
       </div>
      </details>
    </section>`;
    const body=only?card(result.teams[only]):`<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${card(result.teams.A)}${card(result.teams.B)}</div>`;
    return `<div class="${compact?'mt-3':'mb-3'}">
      ${!only?'<div class="text-[13px] font-medium text-zinc-100 mb-2">Why this trade makes sense — or does not</div>':''}
      ${!result.priced?'<p class="text-[12px] text-amber-300 mb-2">At least one asset has no usable listed price. Market edge is unavailable.</p>':!result.marketAvailable?'<p class="text-[12px] text-amber-300 mb-2">Vault market feed unavailable; showing KTC fallback.</p>':''}
      ${body}<p class="text-[11px] text-zinc-400 mt-2">Market price and strategic fit are separate. A strong fit does not erase an overpay.</p></div>`;
  }
  return Object.freeze({side, pair, pieces, explain, assessment, assessmentHtml});
});
