/* Vault league intelligence v0 — descriptive, not a trade grade or forecast.
 * Explicit normalized as-of input; no network, storage, identity, or private publication.
 * Same peer-relative calculations for every roster. Missing is null, not zero.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.VaultLeagueIntelligence=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
  const pct=(v,values)=>{
    const peers=values.filter(finite);
    if(!finite(v)||peers.length<4)return null;
    return (peers.filter(x=>x<v).length+0.5*(peers.filter(x=>x===v).length-1))/(peers.length-1);
  };
  function profileLeague(teams,asOf){
    if(!Array.isArray(teams)||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString().slice(0,10)!==asOf)throw Error('Explicit valid as-of date and teams required');
    const ids=new Set();
    const rows=teams.map(t=>{
      if(t.rosterId==null||ids.has(String(t.rosterId)))throw Error('Unique roster IDs required');
      ids.add(String(t.rosterId));
      const valid=t.complete===true;
      const p=valid&&finite(t.starterPpg)?t.starterPpg:null;
      const value=valid&&finite(t.playerValue)?t.playerValue:null;
      const picks=valid&&finite(t.pickValue)?t.pickValue:null;
      const age=valid&&finite(t.weightedAge)&&t.weightedAge>0?t.weightedAge:null;
      return {rosterId:t.rosterId,starterPpg:p,playerValue:value,pickValue:picks,weightedAge:age};
    });
    const keys=['starterPpg','playerValue','pickValue','weightedAge'];
    const counts=Object.fromEntries(keys.map(k=>[k,rows.filter(r=>finite(r[k])).length]));
    return {asOf,modelVersion:0,scope:'Descriptive peer-relative roster evidence; not validated outcomes or manager intent',teamCount:rows.length,coverage:counts,
      teams:rows.map(r=>{
        const ranks=Object.fromEntries(keys.map(k=>[k,counts[k]===rows.length?pct(r[k],rows.map(x=>x[k])):null]));
        let archetype='unknown';
        if(Object.values(ranks).every(x=>x!==null)){
          const {starterPpg:p,playerValue:v,pickValue:k,weightedAge:a}=ranks;
          if(p>=.75)archetype=a>=.75&&k<=.25?'aging-contender':'contender';
          else if(p<=.25&&v<=.5&&k>=.5)archetype='rebuild-position';
          else if(p<=.25&&a>=.75&&k<=.25)archetype='declining-roster';
          else archetype='retool-or-flexible';
        }
        return {...r,ranks,archetype};
      })};
  }
  // Adapter for current Vault teams. Unknown/unpriced players are disclosed,
  // never converted into observed zero prices. These ranks describe the
  // existing projections and priced subsets, not independent predictions.
  function liveEvidence(teams){
    const rows=teams.map(t=>{
      const relevant=(t.plist||[]).filter(p=>!['K','DEF'].includes(p.pos));
      const priced=relevant.filter(p=>finite(p.value)&&p.value>0);
      const picks=Array.isArray(t.picks)?t.picks:null;
      const pricedPicks=picks?.filter(p=>finite(p.value)&&p.value>0);
      const starters=Array.isArray(t.lineup)?t.lineup:null;
      return {rosterId:t.rosterId,players:relevant.length,pricedPlayers:priced.length,
        picks:picks?.length??null,pricedPicks:pricedPicks?.length??null,
        lineup:starters?.length&&starters.every(p=>p.id&&Number.isFinite(p.ppg))&&finite(t.opt)?t.opt:null,
        playerValue:priced.length?priced.reduce((n,p)=>n+p.value,0):null,
        pickValue:picks&&(picks.length===0||pricedPicks.length===picks.length)?pricedPicks.reduce((n,p)=>n+p.value,0):null,
        age:priced.length&&priced.every(p=>finite(p.age)&&p.age>0)?priced.reduce((n,p)=>n+p.age*p.value,0)/priced.reduce((n,p)=>n+p.value,0):null};
    });
    const fields=['lineup','playerValue','pickValue','age'];
    return rows.map(r=>({...r,ranks:Object.fromEntries(fields.map(k=>[k,rows.every(t=>finite(t[k]))?pct(r[k],rows.map(t=>t[k])):null]))}));
  }
  const windowMs=180*864e5;
  const empty=()=>({completed:0,shapes:0,consolidates:0,splits:0,priced:0,netPicks:0,buysPicks:0,sellsPicks:0,positionCounts:{QB:0,RB:0,WR:0,TE:0}});
  function managerEvidence(teams,grades,activity,asOf,weekErrors=[]){
    if(!Number.isFinite(asOf))throw Error('Explicit as-of timestamp required');
    const byId=new Map(teams.map(t=>[String(t.rosterId),{rosterId:t.rosterId,recent:empty(),prior:empty(),coverage: Array.isArray(activity)?(weekErrors.length?'partial':'loaded'):'unknown'}]));
    const active=new Set(),graded=new Set();
    const bucket=(id,ms)=>{const t=byId.get(String(id));return !t||!Number.isFinite(ms)||ms>asOf||ms<asOf-2*windowMs?null:ms>=asOf-windowMs?t.recent:t.prior;};
    for(const tx of activity||[]){
      const id=String(tx.transaction_id);if(!tx.transaction_id||active.has(id)||tx._ownerAttributionUncertain)continue;
      active.add(id);
      for(const rid of new Set((tx.roster_ids||[]).map(String))){const r=bucket(rid,tx.created);if(r)r.completed++;}
    }
    for(const g of grades||[]){
      const id=g.tx?.transaction_id;if(!id||graded.has(String(id))||g.tx._ownerAttributionUncertain||!g.teamA||!g.teamB||!Array.isArray(g.toA)||!Array.isArray(g.toB))continue;
      graded.add(String(id));
      for(const [team,inc,out] of [[g.teamA,g.toA,g.toB],[g.teamB,g.toB,g.toA]]){
        const r=bucket(team.rosterId,g.created);if(!r||!inc.length||!out.length)continue;
        if(!Array.isArray(activity))r.completed++;
        r.shapes++;if(inc.length<out.length)r.consolidates++;else if(inc.length>out.length)r.splits++;
        for(const pos of new Set(inc.filter(a=>a.type==='player').map(a=>a.pos)))if(Object.hasOwn(r.positionCounts,pos))r.positionCounts[pos]++;
        if(g.valuedAt!=='trade'||g.anyMissingValue||![...inc,...out].every(a=>finite(a.value)&&a.value>0))continue;
        const sum=l=>l.filter(a=>a.type==='pick').reduce((n,a)=>n+a.value,0),net=sum(inc)-sum(out);
        r.priced++;r.netPicks+=net;if(net>500)r.buysPicks++;else if(net< -500)r.sellsPicks++;
      }
    }
    return [...byId.values()];
  }
  function evidenceLines(e,period='recent'){
    if(!e)return ['Manager evidence not loaded'];
    const r=e[period];
    const lines=[r.completed+' observed completed trades · '+r.shapes+' with known packages · '+r.priced+' with trade-day prices'];
    const rate=(n,d,label)=>{if(d>=4&&n>=3&&n/d>=.6)lines.push(label+' ('+n+'/'+d+')');};
    rate(r.consolidates,r.shapes,'Consolidated assets');rate(r.splits,r.shapes,'Expanded asset count');
    rate(r.buysPicks,r.priced,'Added net draft capital');rate(r.sellsPicks,r.priced,'Spent net draft capital');
    for(const [pos,n] of Object.entries(r.positionCounts))rate(n,r.shapes,'Acquired '+pos);
    if(e.coverage!=='loaded')lines.push('History coverage '+e.coverage+'; counts may be incomplete');
    return lines;
  }
  function rosterActions(t,teams,profile,partners,mode){
    const out=[],needs=(profile?.needs||[]).map(x=>String(x).toUpperCase()),surpluses=(profile?.surpluses||[]).map(x=>String(x).toUpperCase());
    if(needs.length)out.push({title:'Review '+needs.join(' / ')+' needs',detail:'Compare current projected starters and depth before making an offer.'});
    if(surpluses.length)out.push({title:'Explore '+surpluses.join(' / ')+' depth',detail:'Consider moving surplus only if both rosters benefit.'});
    if(mode==='rebuild')out.push({title:'Review future assets',detail:'Compare draft capital and younger players against present production.'});
    if(mode==='contend')out.push({title:'Review win-now upgrades',detail:'Prioritize usable lineup gains without assuming a manager will sell.'});
    const best=(partners||[]).find(p=>p.fit>0&&String(p.rosterId)!==String(t.rosterId));
    if(best)out.push({title:'Explore '+best.teamName,detail:'Roster fit signal; no offer or acceptance is confirmed.'});
    return out.slice(0,4);
  }
  return {profileLeague,liveEvidence,managerEvidence,evidenceLines,rosterActions};
});
