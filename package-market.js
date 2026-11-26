/* Observed acquisition prices, separate from additive asset value and roster
   utility. Scope: one stronger player for two pieces. No universal bonus. */
const VaultPackageMarket = (() => {
  const sum=xs=>xs.reduce((n,x)=>n+x.value,0);
  const pos=a=>a.type==='pick'?'PICK':String(a.pos||'').toUpperCase();
  const key=a=>a.type==='pick'?'k:'+a.season+'-'+a.round:'n:'+String(a.name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const signature=xs=>xs.map(a=>pos(a)==='PICK'?'PICK:'+a.round:pos(a)).sort().join('+');
  const finite=a=>Number.isFinite(a.value)&&a.value>0;
  const median=(xs,p=.5)=>{const a=[...xs].sort((x,y)=>x-y),i=(a.length-1)*p,j=Math.floor(i);return a[j]+(a[Math.ceil(i)]-a[j])*(i-j);};
  const normalize=(a,b)=>{
    if(a.length===2&&b.length===1)return {single:b[0],bundle:a,side:'B'};
    if(b.length===2&&a.length===1)return {single:a[0],bundle:b,side:'A'};
    return null;
  };
  function build(data,asOf=new Date().toISOString().slice(0,10)){
    const byName=new Map(),byPos=new Map(),seen=new Set(),objects=new Set();
    if(!data?.byPlayer)return {byName,byPos,asOf};
    for(const trades of data.byPlayer.values())for(const t of trades){
      if(objects.has(t))continue;objects.add(t);
      if(!t?.date||t.date>=asOf||t.date<new Date(Date.parse(asOf)-45*86400000).toISOString().slice(0,10))continue;
      const s=normalize(t.s1||[],t.s2||[]);
      if(!s||s.single.type!=='player'||![s.single,...s.bundle].every(finite)||s.bundle.some(x=>x.value>=s.single.value))continue;
      const name=key(s.single),shape=signature(s.bundle),fmt=t.fmt||{};
      // Same day, format and normalized asset multiset is conservatively one
      // record; no cross-source duplicate inflation, no claim of independent leagues.
      const id=[t.date,fmt.teams,fmt.ppr,fmt.tep,name,...s.bundle.map(key).sort()].join('|');
      if(seen.has(id))continue;seen.add(id);
      const row={date:t.date,name,pos:pos(s.single),shape,lead:s.single.value,ratio:sum(s.bundle)/s.single.value,teams:fmt.teams,tep:fmt.tep,src:t.src||'unknown',minor:Math.min(...s.bundle.map(x=>x.value))/s.single.value,major:Math.max(...s.bundle.map(x=>x.value))/s.single.value};
      if(!byName.has(name))byName.set(name,[]);byName.get(name).push(row);
      if(!byPos.has(row.pos+'|'+shape))byPos.set(row.pos+'|'+shape,[]);byPos.get(row.pos+'|'+shape).push(row);
    }
    return {byName,byPos,asOf};
  }
  function read(index,a,b,{teams,tep}={}){
    const s=normalize(a,b);
    if(!s||!index||s.single.type!=='player'||![s.single,...s.bundle].every(finite)||s.bundle.some(x=>x.value>=s.single.value))return null;
    const name=key(s.single),shape=signature(s.bundle),lead=s.single.value;
    const close=r=>r.lead>=lead*.75&&r.lead<=lead*1.25;
    const own=(index.byName.get(name)||[]).filter(close);
    const peers=(index.byPos.get(pos(s.single)+'|'+shape)||[]).filter(r=>close(r)&&r.minor>=Math.min(...s.bundle.map(x=>x.value))/lead*.5&&r.minor<=Math.min(...s.bundle.map(x=>x.value))/lead*1.5&&Math.abs(r.major-Math.max(...s.bundle.map(x=>x.value))/lead)<=.25);
    const exact=own.filter(r=>r.shape===shape);
    const groups=[{pool:exact,kind:'Same player and package types',min:8},{pool:peers,kind:'Similar players and package types',min:12},{pool:own,kind:'Same player, other two-piece packages included',min:12}];
    let chosen=null;
    for(const g of groups){
      const matched=g.pool.filter(r=>r.teams===teams&&r.tep===tep);
      const teamMatched=g.pool.filter(r=>r.teams===teams);
      if(matched.length>=g.min){chosen={...g,pool:matched,scope:'Same team count and TE format'};break;}
      if(teamMatched.length>=g.min){chosen={...g,pool:teamMatched,scope:'Same team count, mixed TE formats'};break;}
      if(g.pool.length>=g.min){chosen={...g,scope:'Same QB format, mixed league settings'};break;}
    }
    if(!chosen)return {available:false,samePlayer:own.length,exact:exact.length,peers:peers.length,asOf:index.asOf};
    const ratios=chosen.pool.map(r=>r.ratio),mid=median(ratios),low=median(ratios,.25),high=median(ratios,.75),paid=sum(s.bundle),expected=lead*mid;
    const gap=200*(expected-paid)/(expected+paid);
    return {available:true,kind:chosen.kind,scope:chosen.scope,n:ratios.length,leadName:s.single.name,side:s.side,paid,expected,low:lead*low,high:lead*high,premium:100*(mid-1),gap,asOf:index.asOf,oldest:chosen.pool.map(r=>r.date).sort()[0],latest:chosen.pool.map(r=>r.date).sort().at(-1),samePlayer:own.length,exact:exact.length,peers:peers.length,
      // Advisory threshold, not a trained probability or a new official grade.
      material:Math.abs(gap)>=14&&(paid<lead*low||paid>lead*high),below:paid<lead*low,above:paid>lead*high};
  }
  let cachedData=null,cachedIndex=null;
  function live(data,a,b,format){if(!data||data.failed)return null;if(data!==cachedData){cachedIndex=build(data);cachedData=data;}return read(cachedIndex,a,b,format);}
  return {build,read,live};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=VaultPackageMarket;
