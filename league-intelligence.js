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
  return {profileLeague};
});
