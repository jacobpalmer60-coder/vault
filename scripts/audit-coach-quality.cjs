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
 const report={schemaVersion:1,kind:'live-coach-quality',generated:new Date().toISOString(),rows:[],issues:[]};
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(league=>{localStorage.setItem('vault_league_id',league);localStorage.setItem('vault_my_team_'+league,'1');},id);
  const page=await context.newPage();
  page.on('pageerror',e=>report.issues.push('Browser exception: '+e.message.slice(0,250)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/trade.html?league_id='+encodeURIComponent(id),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>typeof teams!=='undefined'&&teams.length>=2&&teams.every(t=>Array.isArray(t.assets)),{},{timeout:90000});
  const rosterIds=await page.evaluate(()=>teams.map(t=>String(t.rosterId)));
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
     const seen=new Set(),partners=new Set(),gaps=[],scores=[],shapes={};
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
      gaps.push(200*Math.abs(va-vb)/(va+vb));
      const a=improvementOf(x.r.j.an,'A'),b=improvementOf(x.r.j.an,'B');
      if(!x.evidence.ok||!x.r.yes||!x.evidence.a.length||!x.evidence.b.length)issues.push('missing bilateral benefit or simulated willingness');
      if(!Number.isFinite(a.score)||!Number.isFinite(b.score))issues.push('missing grade');
      if(rosterCap&&(projectedRosterCount(me,x.give,x.get)>rosterCap||projectedRosterCount(x.t,x.get,x.give)>rosterCap))issues.push('roster overflow');
      scores.push(Math.min(a.score,b.score));
      const shape=give.length+'-for-'+get.length;shapes[shape]=(shapes[shape]||0)+1;
     }
     return {rosterId:rid,mode:Vault.teamMode(me),partnersScreened:run.partners,candidates:run.of,offers:run.list?.length||0,distinctPartners:partners.size,
      maxAdditiveGap:gaps.length?Math.max(...gaps):null,meanAdditiveGap:gaps.length?gaps.reduce((s,v)=>s+v,0)/gaps.length:null,minBilateralScore:scores.length?Math.min(...scores):null,shapes,issues};
    },{rid,before});
    row.seconds=(Date.now()-start)/1000;report.rows.push(row);
    console.error('[coach audit] '+rid+' '+row.mode+': '+row.offers+' offers / '+row.distinctPartners+' partners, '+row.seconds.toFixed(1)+'s; '+row.issues.length+' issues');
   }catch(e){report.rows.push({rosterId:rid,seconds:(Date.now()-start)/1000,issues:[String(e.message).slice(0,250)]});}
  }
  await context.close();
 }finally{await browser.close();}
 const success=report.rows.filter(r=>!r.issues.length);
 report.summary={teams:report.rows.length,completed:success.length,teamsWithOffers:success.filter(r=>r.offers>0).length,offers:success.reduce((s,r)=>s+r.offers,0),maxSeconds:Math.max(0,...report.rows.map(r=>r.seconds)),failedTeams:report.rows.length-success.length,browserErrors:report.issues.length};
 report.caveats=['Current league, existing valuations, simulated willingness only. Counts and checks are not an empirical acceptance rate.','Empty recommendations may be appropriate but warrant review; search is bounded, not exhaustive.','Warm manager history; not a cold-page benchmark.'];
 console.log(JSON.stringify(report,null,2));
 if(report.summary.failedTeams||report.summary.browserErrors)process.exitCode=1;
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(()=>server.close());
