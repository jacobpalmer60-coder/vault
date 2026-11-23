/* Read-only Sleeper league activity. One season at a time, all managers by default. */
(function(){
'use strict';
const $=id=>document.getElementById(id),esc=v=>Vault.escapeHtml(String(v??''));
const href=(page,params={},linkedLeagueId=leagueId)=>{const u=new URL(Vault.linkTo(page,linkedLeagueId),location.href);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));return u.pathname.split('/').pop()+u.search+u.hash};
let leagueId='',seasonChain=[],active=null,result=null,shown=35,currentToken=0;
const dateOf=e=>e.when?new Date(e.when).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Date unavailable';
const typeLabel={trade:'Trade',waiver:'Waiver',free_agent:'Free agent',draft:'Draft',commissioner:'Commissioner',roster:'Roster move'};
function render(){
 if(!result)return;
 const team=$('activityTeam').value||'all',kind=$('activityType').value||'all',status=$('activityStatus').value||'complete',q=$('activitySearch').value||'';
 const list=VaultActivity.filter(result.events,{team,kind,status,q});
 $('count').textContent=list.length+' matching events · '+result.events.length+' total returned · '+result.checked+'/'+result.total+' transaction weeks available';
 const displayed=list.slice(0,shown);
 $('events').innerHTML=displayed.length?displayed.map(e=>{
  const when=dateOf(e);
  const people=e.affected.map(a=>{
   const known=result.teams.some(t=>String(t.rosterId)===String(a.id));
   const tm=known?'<a class="vault-link" href="'+href('team-analyzer.html',{team:a.id},e.leagueId)+'" title="Open this team in the '+esc(e.season)+' Sleeper season">'+esc(a.name)+'</a>':'<span title="Historical roster owner unverified">'+esc(a.name)+'</span>';
   const got=a.gets.length?'<span class="vault-event-pos">Added: '+esc(a.gets.slice(0,5).join(', '))+(a.gets.length>5?' +'+(a.gets.length-5)+' more':'')+'</span>':'';
   const lost=a.loses.length?'<span class="vault-event-neg">Moved: '+esc(a.loses.slice(0,5).join(', '))+(a.loses.length>5?' +'+(a.loses.length-5)+' more':'')+'</span>':'';
   return '<div class="vault-event-side"><span class="vault-event-team">'+tm+'</span><span class="vault-event-moves">'+got+lost+'</span></div>';
  }).join('');
  const badge='<span class="vault-event-tag '+esc(e.kind)+'">'+esc(typeLabel[e.kind]||e.description)+'</span>';
  const grade=e.linkable?'<a class="vault-link vault-event-detail" href="'+href('trade_grades.html',{},leagueId)+'#trade-'+encodeURIComponent(e.id)+'">Graded view (if priced)</a>':'';
  const stamp=e.kind==='draft'&&e.sourceTimestamp==='draft-start'?' · draft start date (selection time unavailable)':'';
  return '<article class="vault-event-card"><div class="vault-event-top">'+badge+'<span class="vault-meta">'+esc(when)+(e.week>=0?' · Week '+e.week:'')+esc(stamp)+'</span></div>'+
   '<div class="vault-event-title">'+esc(e.description)+(e.status!=='complete'?' · '+esc(e.status):'')+'</div>'+
   '<div class="vault-event-sides">'+people+'</div><div class="vault-event-foot">'+grade+'<span class="vault-meta">Sleeper '+esc(e.id)+'</span></div></article>';
 }).join(''):'<div class="vault-empty">No matching activity in the returned transaction and draft records. Change filters to see more.</div>';
 $('loadMore').classList.toggle('hidden',displayed.length>=list.length);
 $('loadMore').textContent='Show more · '+(list.length-displayed.length)+' remaining';
}
function filters(){
 const picked=new URLSearchParams(location.search).get('team')||'all';
 $('activityTeam').innerHTML='<option value="all">All managers</option>'+result.teams.map(t=>'<option value="'+esc(t.rosterId)+'">'+esc(t.teamName)+'</option>').join('');
 $('activityTeam').value=result.teams.some(t=>String(t.rosterId)===picked)?picked:'all';
 const on=()=>{shown=35;render()};
 for(const key of ['activityTeam','activityType','activityStatus'])$(key).onchange=on;
 $('activitySearch').oninput=on;
 $('loadMore').onclick=()=>{shown+=35;render()};
}
async function load(s){
 const token=++currentToken;active=s;
 $('activityStatusText').textContent='Loading '+s.season+' transactions…';
 $('activityBody').classList.add('hidden');$('loadError').classList.add('hidden');
 try{
  const base='https://api.sleeper.app/v1/league/'+encodeURIComponent(s.leagueId);
  const progress=({done,total,failures})=>{if(token===currentToken)$('activityStatusText').textContent='Loading '+s.season+' · '+done+'/'+total+' weeks checked'+(failures?' · '+failures+' unavailable':'')};
  const [rosters,users,players,days,drafts]=await Promise.all([
   Vault.sleeperJson(base+'/rosters',30),
   Vault.sleeperJson(base+'/users',30),
   Vault.fetchSleeperPlayers(),
   Vault.fetchLeagueTradeWeeks([s],leagueId,progress),
   Vault.sleeperJson(base+'/drafts',30).catch(()=>[])
  ]);
  if(!Array.isArray(rosters)||!Array.isArray(users))throw Error('Missing Sleeper roster/manager list.');
  const picks=await Promise.all((Array.isArray(drafts)?drafts:[]).map(async d=>{
   try{return {draft:d,picks:await Vault.sleeperJson('https://api.sleeper.app/v1/draft/'+encodeURIComponent(d.draft_id)+'/picks',60)}}catch{return {draft:d,picks:[]}}
  }));
  if(token!==currentToken)return;
  const weeks=Array.from({length:19},(_,i)=>days.get(String(s.leagueId)+':'+i)??null);
  result=VaultActivity.build({weeks,rosters,users,players,drafts:picks,season:s.season,leagueId:s.leagueId});
  const partial=result.missingWeeks.length;
  $('coverage').innerHTML=partial?'<p class="vault-warning">Partial feed: '+result.checked+' of '+result.total+' weeks retrieved. Missing weeks: '+result.missingWeeks.join(', ')+'. Counts may be incomplete; missing weeks are not treated as zero trades.</p>':
   '<p class="vault-meta">Complete week coverage: all '+result.total+' transaction weeks returned by Sleeper. No missing weeks were silently ignored.</p>';
  $('activityStatusText').textContent=s.season+' season · '+result.transactions+' unique transactions · '+result.draftPicks+' draft selections · '+new Date().toLocaleTimeString();
  $('activityBody').classList.remove('hidden');shown=35;filters();render();
 }catch(e){if(token!==currentToken)return;$('loadError').textContent='League activity unavailable: '+e.message+'. Try Refresh or another season.';$('loadError').classList.remove('hidden');$('activityStatusText').textContent='Data loading failed';console.error(e)}
}
(async()=>{
 try{
  leagueId=Vault.getLeagueId();if(!leagueId)throw Error('Select a Sleeper league.');
  const league=await Vault.sleeperJson('https://api.sleeper.app/v1/league/'+encodeURIComponent(leagueId),5);
  seasonChain=await Vault.fetchSeasonChain(leagueId,league);
  if(!seasonChain.length)throw Error('No seasons associated with this league.');
  $('activitySeason').innerHTML=seasonChain.map(s=>'<option value="'+esc(s.leagueId)+'">'+esc(s.season)+'</option>').join('');
  const q=new URLSearchParams(location.search).get('season');
  const s=seasonChain.find(s=>String(s.season)===String(q)||String(s.leagueId)===String(q))||seasonChain[0];
  $('activitySeason').value=s.leagueId;
  $('activitySeason').onchange=e=>{const next=seasonChain.find(s=>String(s.leagueId)===e.target.value)||seasonChain[0];const u=new URL(location.href);u.searchParams.set('season',next.season);history.replaceState(null,'',u);load(next)};
  $('retryActivity').onclick=()=>load(active||s);
  await load(s);
 }catch(e){$('activityStatusText').textContent='Activity unavailable: '+e.message;$('loadError').classList.remove('hidden');console.error(e)}
})();
})();
