#!/usr/bin/env node
'use strict';
// Live read-only evaluation of the actual browser Coach for EVERY roster.
// No upload or trade submission. Prints aggregate quality and timing, plus
// anonymous roster IDs and issue labels. Local report is not historical validation.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const id=process.argv[2];assert.match(id||'',/^\d+$/,'Usage: node scripts/audit-coach-quality.cjs <league-id>');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 try{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!['.html','.js','.json','.css','.png','.svg','.webp','.jpg','.woff2'].includes(path.extname(file))||file.includes(path.sep+'node_modules'+path.sep)||file.includes(path.sep+'research'+path.sep)){res.writeHead(403).end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});const stream=fs.createReadStream(file);stream.on('error',()=>res.end());stream.pipe(res);
 }catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const report={schemaVersion:2,kind:'live-coach-quality',generated:new Date().toISOString(),rows:[],issues:[]};
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(league=>{localStorage.setItem('vault_league_id',league);localStorage.setItem('vault_my_team_'+league,'1');},id);
  const page=await context.newPage();
  page.on('pageerror',e=>report.issues.push('Browser exception: '+e.message.slice(0,250)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/trade.html?league_id='+encodeURIComponent(id),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>typeof teams!=='undefined'&&teams.length>=2&&teams.every(t=>Array.isArray(t.assets)),{},{timeout:90000});
  const rosterIds=await page.evaluate(()=>teams.map(t=>String(t.rosterId)));
  report.pricePolicy=await page.evaluate(()=>({marketFairLimit:VAULT_CONFIG.FAIR_PCT,ktcAdjustedLimit:VAULT_CONFIG.LOPSIDED_PCT,activeMarketTable:!!Vault._gradeMarket,marketUpdated:Vault._gradeMarketUpdated||null,sign:'Positive means subject receives more; negative means subject sends more. Symmetric percentage of mean side value.'}));
  // Stabilize historical evidence before measuring the warmed-up search.
  await page.evaluate(async()=>{await negPreloadStyles();});
  for(const rid of rosterIds){
   const start=Date.now();
   try{
    const before=await page.evaluate(rid=>{
     if(!document.getElementById('setup').classList.contains('hidden'))document.getElementById('loadRostersBtn').click();
     const a=document.getElementById('teamA'),b=document.getElementById('teamB');
     a.value=rid;a.dispatchEvent(new Event('change'));
     b.value=String(teams.find(t=>String(t.rosterId)!==rid).rosterId);b.dispatchEvent(new Event('change'));
     coachFresh();openCoach('coach');coachDiscoverStart();
     return JSON.stringify({A:[...selectedA],B:[...selectedB]});
    },rid);
    await page.waitForFunction(()=>Array.isArray(coachFlow().aimRun?.list)||coachFlow().aimRun?.error,{},{timeout:180000});
    const row=await page.evaluate(({rid,before})=>{
     const me=coachMe(),run=coachFlow().aimRun,issues=[];
     if(run.error)issues.push('search error');
     if(String(me.rosterId)!==rid)issues.push('wrong subject roster');
     if(run.partners!==teams.length-1)issues.push('partner coverage mismatch');
     if(run.done!==run.of)issues.push('incomplete search');
     if(JSON.stringify({A:[...selectedA],B:[...selectedB]})!==before)issues.push('builder mutation');
     const seen=new Set(),partners=new Set(),gaps=[],scores=[],shapes={},offers=[];
     const signed=(sent,received)=>sent+received>0?200*(received-sent)/(sent+received):null;
     for(const x of run.list||[]){
      const keys=l=>l.map(p=>String(p.key)),give=keys(x.give),get=keys(x.get);
      const key=String(x.t.rosterId)+':'+give.sort().join(',')+'>'+get.sort().join(',');
      if(seen.has(key))issues.push('duplicate offer');seen.add(key);
      partners.add(String(x.t.rosterId));
      if(String(x.t.rosterId)===rid)issues.push('self trade');
      if(!give.length||!get.length||new Set(give).size!==give.length||new Set(get).size!==get.length)issues.push('invalid asset package');
      if(!give.every(k=>me.assets.some(p=>String(p.key)===k))||!get.every(k=>x.t.assets.some(p=>String(p.key)===k)))issues.push('asset ownership mismatch');
      const vals=l=>l.reduce((s,p)=>s+p.value,0),va=vals(x.give),vb=vals(x.get);
      if(![...x.give,...x.get].every(p=>Number.isFinite(p.value)&&p.value>0))issues.push('missing asset price');
      const listed=signed(va,vb),market=Vault.marketSideValues(x.give,x.get),ktc=Vault.ktcSideValues(x.give,x.get);
      const active=signed(market.valueA,market.valueB),ktcRaw=signed(ktc.rawA,ktc.rawB),ktcAdjusted=signed(ktc.valueA,ktc.valueB);
      gaps.push(Math.abs(listed));
      if(active===null||Math.abs(active)>=VAULT_CONFIG.FAIR_PCT)issues.push('active market price outside Discover gate');
      if(ktcAdjusted===null||Math.abs(ktcAdjusted)>=VAULT_CONFIG.LOPSIDED_PCT)issues.push('KTC adjusted price outside Discover gate');
      const a=improvementOf(x.r.j.an,'A'),b=improvementOf(x.r.j.an,'B');
      if(!x.evidence.ok||!x.r.yes||!x.evidence.a.length||!x.evidence.b.length)issues.push('missing bilateral benefit or simulated willingness');
      if(!Number.isFinite(a.score)||!Number.isFinite(b.score))issues.push('missing grade');
      if(a.score<0&&b.score<0)issues.push('both grades negative');
      if(rosterCap&&(projectedRosterCount(me,x.give,x.get)>rosterCap||projectedRosterCount(x.t,x.get,x.give)>rosterCap))issues.push('roster overflow');
      scores.push(Math.min(a.score,b.score));
      offers.push({partnerRosterId:String(x.t.rosterId),give:x.give.map(p=>({name:p.name,listed:p.value,market:Vault.gradeValue(p),ktc:p.ktcPrice??p.value})),get:x.get.map(p=>({name:p.name,listed:p.value,market:Vault.gradeValue(p),ktc:p.ktcPrice??p.value})),listedSignedGap:listed,activeMarketSignedGap:active,ktcRawSignedGap:ktcRaw,ktcAdjustedSignedGap:ktcAdjusted,scoreA:a.score,scoreB:b.score,benefitA:x.evidence.a,benefitB:x.evidence.b,simulatedWillingness:!!x.r.yes});
      const shape=give.length+'-for-'+get.length;shapes[shape]=(shapes[shape]||0)+1;
     }
     const metrics=list=>{const counts=new Map();for(const x of list)for(const p of [...x.give,...x.get])counts.set(p.key,(counts.get(p.key)||0)+1);return {offers:list.length,nonnegativeBoth:list.filter(x=>x.mutual>=0).length,partners:new Set(list.map(x=>x.t.rosterId)).size,distinctAssets:counts.size,maxAssetRepeats:Math.max(0,...counts.values()),meanMinimumGrade:list.length?list.reduce((s,x)=>s+x.mutual,0)/list.length:null};};
     return {rosterId:rid,mode:Vault.teamMode(me),partnersScreened:run.partners,candidates:run.of,eligible:run.eligible,rankingComparison:{baseline:metrics(run.baseline||[]),new:metrics(run.list||[])},offers:run.list?.length||0,distinctPartners:partners.size,
      maxAdditiveGap:gaps.length?Math.max(...gaps):null,meanAdditiveGap:gaps.length?gaps.reduce((s,v)=>s+v,0)/gaps.length:null,minBilateralScore:scores.length?Math.min(...scores):null,shapes,issues,offerDetails:offers};
    },{rid,before});
    row.seconds=(Date.now()-start)/1000;report.rows.push(row);
    console.error('[coach audit] '+rid+' '+row.mode+': '+row.offers+' offers / '+row.distinctPartners+' partners, '+row.seconds.toFixed(1)+'s; '+row.issues.length+' issues');
   }catch(e){report.rows.push({rosterId:rid,seconds:(Date.now()-start)/1000,issues:[String(e.message).slice(0,250)]});}
  }
  await context.close();
 }finally{await browser.close();}
 const success=report.rows.filter(r=>!r.issues.length);
 report.summary={teams:report.rows.length,completed:success.length,teamsWithOffers:success.filter(r=>r.offers>0).length,offers:success.reduce((s,r)=>s+r.offers,0),maxSeconds:Math.max(0,...report.rows.map(r=>r.seconds)),failedTeams:report.rows.length-success.length,browserErrors:report.issues.length};
 const offers=success.flatMap(r=>r.offerDetails||[]);
 const summaryGap=k=>({meanAbsolute:offers.length?offers.reduce((n,o)=>n+Math.abs(o[k]),0)/offers.length:null,maxAbsolute:offers.length?Math.max(...offers.map(o=>Math.abs(o[k]))):null,atLeast14:offers.filter(o=>Math.abs(o[k])>=14).length,atLeast30:offers.filter(o=>Math.abs(o[k])>=30).length,subjectPaysMore:offers.filter(o=>o[k]<0).length,partnerPaysMore:offers.filter(o=>o[k]>0).length});
 report.priceGaps=Object.fromEntries(['listedSignedGap','activeMarketSignedGap','ktcRawSignedGap','ktcAdjustedSignedGap'].map(k=>[k,summaryGap(k)]));
 report.caveats=['Current league, existing valuations, simulated willingness only. Counts and checks are not an empirical acceptance rate.','Empty recommendations may be appropriate but warrant review; search is bounded, not exhaustive.','Warm manager history; not a cold-page benchmark.','Listed asset prices, active Vault market prices, raw KTC and adjusted KTC prices differ. Old maxAdditiveGap/meanAdditiveGap fields measure listed values, not the active market gate.','Detailed offer names are local report output only; do not publish league-specific reports automatically.'];
 console.log(JSON.stringify(report,null,2));
 if(report.summary.failedTeams||report.summary.browserErrors)process.exitCode=1;
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(()=>server.close());
