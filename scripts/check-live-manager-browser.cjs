#!/usr/bin/env node
'use strict';
// Real-league UI acceptance, not a stubbed Sleeper fixture.
// Pages are served as static GitHub Pages assets from the checked-out commit.
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const leagueId=process.env.VAULT_LIVE_LEAGUE_ID,rosterId=process.env.VAULT_LIVE_ROSTER_ID||'10';
const target=process.env.VAULT_EXPECT_TRADE_ID;
assert.match(leagueId||'',/^\d+$/);assert.match(target||'',/^\d+$/);
const ROOT=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png'};
(async()=>{
 const server=http.createServer((req,res)=>{
  const p=path.resolve(ROOT,'.'+decodeURIComponent((req.url||'/').split('?')[0]));
  if(!p.startsWith(ROOT+path.sep)) {res.writeHead(403);res.end();return}
  try{res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream'});res.end(fs.readFileSync(p));}
  catch {res.writeHead(404);res.end('not found')}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:850}});
  await context.addInitScript(({id,team})=>{
   localStorage.setItem('vault_league_id',id);
   localStorage.setItem('vault_my_team_'+id,team);
  },{id:leagueId,team:rosterId});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const load=async (url,selector)=>{
   const start=Date.now();
   await page.goto(origin+'/'+url+'?league_id='+leagueId,{waitUntil:'domcontentloaded',timeout:45000});
   await page.locator(selector).waitFor({timeout:120000});
   const body=await page.locator('#status').innerText();
   assert.ok(!/could not load|failed to load|unexpected error/i.test(body),url+' error '+body);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   assert.ok(overflow<=2,url+' has document horizontal overflow '+overflow+'px');
   console.log('Loaded',url,'in',((Date.now()-start)/1000).toFixed(1),'seconds:',body.slice(0,160));
  };
  await load('managers.html','#tradeEvidence:not(.hidden)');
  const toggle=page.locator('#manager-toggle-'+rosterId);
  assert.equal(await toggle.count(),1,'Expected TURBONUTZ manager row must appear');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  const panel=await page.locator('#manager-detail-'+rosterId).innerText();
  assert.ok(panel.includes(target),'Recent completed trade '+target+' missing from Manager history');
  // These views intentionally hide *grades* lacking historical prices.
  // Their raw count must still be displayed; not every trade should get a
  // fabricated grade just to make the UI look complete.
  await load('trade_grades.html','#tradeEvidence:not(.hidden)');
  assert.ok((await page.locator('#status').innerText()).includes('reliably graded of'));
  if(await page.locator('#list > button').count()){
   await page.locator('#list > button').first().click();
   const panel=page.getByRole('region',{name:'Historical price comparison'});
   await panel.waitFor({timeout:15000});
   assert.ok((await panel.innerText()).includes('Roster fit: not evaluated'));
   await panel.getByText('Compare package adjustment',{exact:true}).click();
   assert.ok(await panel.getByText('KTC-style adjustment using these same recorded base prices.',{exact:false}).isVisible());
   console.log('PASS real completed trade detail and package comparison');
  }
  assert.deepEqual(errors,[],'Unhandled browser errors during real manager/grade pages');
  await context.close();
  console.log('PASS real league: manager trade ID, grades evidence, small-screen layout and no JS errors');
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
