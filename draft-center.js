/* Draft Center browser controller. Uses VaultDraftOrder; never writes league data to Sleeper. */
(function(){
'use strict';
const $=id=>document.getElementById(id),esc=v=>Vault.escapeHtml(String(v??''));
const fmt=v=>Number.isFinite(+v)?(+v).toLocaleString(undefined,{maximumFractionDigits:2}):'—';
const ordinal=v=>v+({1:'st',2:'nd',3:'rd'}[v]||'th');
const srcLabel={mpf:'MPF order', 'projected-mpf':'Projected playoff field', 'sleeper-placement':'Sleeper bracket',
 'manual-slot':'Manual override','playoff-pending':'Playoff finish TBD',pending:'Awaiting data',conflict:'Conflicting slot'};
let league=null,teams=[],rosters=[],bracket=[],year=0,years=[],leagueId='',selected='all',settings={},model=null,bracketError='';
const storageKey=()=> 'vault_draft_rules_v2_'+leagueId+'_'+year;
const name=id=>teams.find(t=>String(t.rosterId)===String(id))?.teamName||'Roster '+id;
const href=(page,params={})=>{const u=new URL(Vault.linkTo(page),location.href);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));return u.pathname.split('/').pop()+u.search;};
const teamLink=(id,label)=>'<a class="vault-link" href="'+href('team-analyzer.html',{team:id})+'">'+esc(label||name(id))+'</a>';
const pickUrl=id=>href('trade.html',{a:Vault.getMyTeamId(leagueId)||id,b:id});
const future=()=>year!==+league.season+1;
function defaults(){return {playoffCount:+league.settings?.playoff_teams||Math.min(6,teams.length),roundStyle:'linear',playoffIds:[],manualSlots:{}};}
function loadRules(){
 const standard=defaults();try{
  const saved=JSON.parse(localStorage.getItem(storageKey())||'null');
  if(!saved||typeof saved!=='object')return standard;
  return {playoffCount:Number.isInteger(+saved.playoffCount)&&+saved.playoffCount<=teams.length?+saved.playoffCount:standard.playoffCount,
   roundStyle:['linear','snake','3rr'].includes(saved.roundStyle)?saved.roundStyle:'linear',
   playoffIds:Array.isArray(saved.playoffIds)?saved.playoffIds.map(String).filter(x=>teams.some(t=>String(t.rosterId)===x)):[],
   manualSlots:saved.manualSlots&&typeof saved.manualSlots==='object'?saved.manualSlots:{}};
 }catch{return standard}
}
function saveRules(){try{localStorage.setItem(storageKey(),JSON.stringify(settings))}catch{}}
function rulesChanged(key,value){settings[key]=value;saveRules();render()}
const allPicks=()=>teams.flatMap(t=>(t.picks||[]).filter(p=>+p.season===year).map(p=>({holder:t,asset:p})));
const slotFormat=p=>p.roundSlot==null?'TBD':p.round+'.'+String(p.roundSlot).padStart(2,'0');
function compute(){
 model=VaultDraftOrder.build({teams,rosters:future()?[]:rosters,bracket:future()?[]:bracket,league,settings});
}
function render(){
 if(!league)return;
 compute();
 const picks=VaultDraftOrder.applyPicks(teams,year,model,settings.roundStyle);
 const byOriginal=new Map(picks.map(p=>[p.round+'|'+p.original,p]));
 const chosen=selected==='all'?null:selected;
 $('season').value=String(year);$('teamFilter').value=selected;
 $('roundStyle').value=settings.roundStyle;$('playoffCount').value=String(settings.playoffCount);
 $('draftStatus').textContent=league.name+' · '+teams.length+' managers · '+year+' picks';
 $('dataState').textContent=bracketError?'Playoff bracket unavailable; manual placements are possible.':future()?'Future draft season: current MPF and playoff finish cannot determine these slots.':model.qualifierSource==='sleeper-bracket'?'Playoff field verified against Sleeper bracket.':model.qualifierSource==='manual'?'Playoff field selected in this browser.':'Playoff field remains provisional.';
 const warnings=[...model.warnings];if(future())warnings.unshift('For '+year+', automatic slots remain unknown until the preceding season; manual estimates are clearly labeled.');
 $('warnings').innerHTML=warnings.map(w=>'<p class="vault-warning">'+esc(w)+'</p>').join('');
 const mpf=teams.map(t=>({t,value:VaultDraftOrder.mpfOf(rosters.find(r=>String(r.roster_id)===String(t.rosterId)))}))
  .sort((a,b)=>(a.value??Infinity)-(b.value??Infinity)||a.t.teamName.localeCompare(b.t.teamName));
 $('mpfCoverage').textContent=mpf.filter(x=>x.value!=null).length+' of '+teams.length+' MPF totals available; figures are from this Sleeper season and may not be final.';
 $('mpfRows').innerHTML=mpf.map(({t,value},i)=>'<tr><td>'+ (value==null?'—':i+1)+'</td><td>'+teamLink(t.rosterId,t.teamName)+'</td><td class="value">'+(value==null?'—':fmt(value))+'</td></tr>').join('');
 $('orderRows').innerHTML=model.rows.map(r=>{
   const pick=picks.find(p=>p.original===r.rosterId&&p.round===1);
   const label=r.playoff===null?'Unknown':r.playoff?'Playoffs':'Non-playoff';
   return '<tr><td class="value">'+(r.slot??'TBD')+'</td><td>'+teamLink(r.rosterId,r.teamName)+'</td><td class="muted">'+label+'</td><td class="muted">'+(srcLabel[r.source]||r.source)+'</td><td class="value">'+(pick?slotFormat(pick):'—')+'</td></tr>';
 }).join('');
 const capital=teams.map(t=>({t,picks:picks.filter(p=>p.holder===String(t.rosterId))}))
  .sort((a,b)=>b.picks.reduce((s,p)=>s+(+p.value||0),0)-a.picks.reduce((s,p)=>s+(+p.value||0),0));
 $('capitalRows').innerHTML=capital.map(({t,picks:ps})=>'<tr><td>'+teamLink(t.rosterId,t.teamName)+'</td><td class="value">'+ps.filter(p=>p.round===1).length+'</td><td class="value">'+ps.length+'</td><td class="value">'+fmt(ps.reduce((s,p)=>s+(+p.value||0),0))+'</td></tr>').join('');
 const filtered=picks.filter(p=>!chosen||chosen===p.original||chosen===p.holder);
 $('pickRows').innerHTML=filtered.length?filtered.map(p=>'<tr><td class="value">'+(p.roundSlot==null?year+' '+ordinal(p.round):year+' '+slotFormat(p))+'</td><td>'+teamLink(p.original)+'</td><td>'+teamLink(p.holder)+'</td><td class="value">'+fmt(p.value)+'</td><td class="muted">'+(srcLabel[p.source]||'TBD')+'</td></tr>').join(''):
 '<tr><td colspan="5" class="muted">No future tradable picks match this filter.</td></tr>';
 $('manualRows').innerHTML=model.rows.map(r=>{
  const current=settings.manualSlots[r.rosterId]??'';
  const opts=['<option value="">Use source data</option>',...Array.from({length:teams.length},(_,i)=>'<option value="'+(i+1)+'" '+(String(current)===String(i+1)?'selected':'')+'>'+(i+1)+'</option>')].join('');
  const checked=(settings.playoffIds||[]).map(String).includes(r.rosterId);
  return '<div class="draft-rule-row"><label><input type="checkbox" data-playoff="'+esc(r.rosterId)+'" '+(checked?'checked':'')+'> '+esc(r.teamName)+'</label><select data-slot="'+esc(r.rosterId)+'" aria-label="Slot override for '+esc(r.teamName)+'">'+opts+'</select></div>';
 }).join('');
 $('selectedCount').textContent=(settings.playoffIds||[]).length+' selected of '+settings.playoffCount+' playoff teams. If the count is wrong, Sleeper bracket or projected standings will be used.';
 $('draftReady').textContent=model.complete?'All draft-order slots calculated from available inputs.':'Some slots remain projected or unresolved. No official order is claimed.';
 $('draftContent').classList.remove('hidden');
}
function attach(){
 $('season').onchange=e=>{year=+e.target.value;settings=loadRules();selected='all';render()};
 $('teamFilter').onchange=e=>{selected=e.target.value;render()};
 $('roundStyle').onchange=e=>rulesChanged('roundStyle',e.target.value);
 $('playoffCount').onchange=e=>{settings.playoffCount=+e.target.value;settings.playoffIds=[];saveRules();render()};
 $('resetRules').onclick=()=>{settings=defaults();saveRules();render()};
 $('manualRows').onchange=e=>{
  const play=e.target.dataset.playoff,slot=e.target.dataset.slot;
  if(play){const set=new Set((settings.playoffIds||[]).map(String));e.target.checked?set.add(play):set.delete(play);settings.playoffIds=[...set];}
  if(slot){settings.manualSlots={...settings.manualSlots};if(e.target.value)settings.manualSlots[slot]=+e.target.value;else delete settings.manualSlots[slot];}
  saveRules();render();
 };
 $('refreshDraft').onclick=()=>location.reload();
}
(async()=>{
 try{
  leagueId=Vault.getLeagueId();if(!leagueId)throw Error('Choose a Sleeper league first.');
  const [built,rosterData]=await Promise.all([Vault.buildLeagueTeams(leagueId),Vault.sleeperJson('https://api.sleeper.app/v1/league/'+encodeURIComponent(leagueId)+'/rosters',3)]);
  league=built.league;teams=built.teams;rosters=rosterData;
  if(!Array.isArray(rosters)||!teams.length)throw Error('Sleeper roster data unavailable.');
  try{bracket=await Vault.sleeperJson('https://api.sleeper.app/v1/league/'+encodeURIComponent(leagueId)+'/winners_bracket',10);if(!Array.isArray(bracket))throw Error('Invalid bracket format')}
  catch(e){bracket=[];bracketError=e.message}
  years=[...new Set(teams.flatMap(t=>(t.picks||[]).map(p=>+p.season)))].filter(Number.isFinite).sort((a,b)=>a-b);
  if(!years.length)throw Error('No current tradable future picks exist for this league.');
  const requested=+new URLSearchParams(location.search).get('season');
  year=years.includes(requested)?requested:years[0];settings=loadRules();
  $('season').innerHTML=years.map(y=>'<option value="'+y+'">'+y+'</option>').join('');
  $('teamFilter').innerHTML='<option value="all">All managers</option>'+teams.slice().sort((a,b)=>a.teamName.localeCompare(b.teamName)).map(t=>'<option value="'+esc(t.rosterId)+'">'+esc(t.teamName)+'</option>').join('');
  const selectedFromUrl=new URLSearchParams(location.search).get('team');
  if(teams.some(t=>String(t.rosterId)===String(selectedFromUrl)))selected=String(selectedFromUrl);
  $('playoffCount').innerHTML=Array.from({length:teams.length+1},(_,n)=>'<option value="'+n+'">'+n+'</option>').join('');
  attach();render();
 }catch(e){$('draftStatus').textContent='Could not load Draft Center: '+e.message;$('draftError').classList.remove('hidden');console.error(e)}
})();
})();
