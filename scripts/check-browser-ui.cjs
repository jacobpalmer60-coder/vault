#!/usr/bin/env node
'use strict';
// Headless real Chromium acceptance at phone/tablet/desktop widths, using a
// deterministic Sleeper fixture. Physical iOS/Android still require device QA.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const ROOT=path.join(__dirname,'..'),OUT=path.join(ROOT,'browser-smoke-artifacts');
const fixture=`
let historicalRosterAttempts=0;
const Vault={
  getLeagueId:()=> '123',getMyTeamId:()=>1,linkTo:(p,id)=>p+'?league_id='+(id||'123'),
  escapeHtml:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
  buildLeagueTeams:async()=>({league:{name:'Fixture League',season:'2026',settings:{playoff_teams:4}},
    teams:Array.from({length:6},(_,i)=>({rosterId:i+1,teamName:'Team '+(i+1),record:{wins:i+1,losses:10-i},
    picks:[{season:2027,round:1,original:i+1,value:4000},{season:2027,round:2,original:i+1,value:1900}]}))}),
  sleeperJson:async u=>{
    if(u.includes('/league/122/rosters')&&historicalRosterAttempts++===0)throw Error('Temporary historical roster outage');
    if(u.includes('/winners_bracket'))return [{r:1,t1:3,t2:4,w:3,l:4,p:3},{r:2,t1:5,t2:6,w:6,l:5,p:1}];
    if(u.includes('/rosters'))return Array.from({length:6},(_,i)=>({roster_id:i+1,owner_id:'u'+(i+1),settings:{ppts:1000+i*10,ppts_decimal:25}}));
    if(u.includes('/users'))return Array.from({length:6},(_,i)=>({user_id:'u'+(i+1),display_name:'Team '+(i+1)}));
    if(u.includes('/league/123/drafts'))return [{draft_id:'D',start_time:1700000000000,status:'complete'}];
    if(u.includes('/draft/D/picks'))return [{pick_no:1,round:1,draft_slot:1,roster_id:3,player_id:'p3'}];
    if(u.includes('/league/123'))return {league_id:'123',name:'Fixture League',season:'2026',settings:{playoff_teams:4}};
    throw Error('Unmocked Sleeper URL '+u);
  },
  fetchSeasonChain:async()=>[{leagueId:'123',season:'2026'},{leagueId:'122',season:'2025'}],
  fetchSleeperPlayers:async()=>({p1:{first_name:'First'},p2:{first_name:'Second'},p3:{first_name:'Third'}}),
  fetchLeagueTradeWeeks:async(a,id,cb)=>{
    const m=new Map(),lid=String(a[0].leagueId);for(let i=0;i<19;i++)m.set(lid+':'+i,i===8?null:[]);
    m.set(lid+':0',[{transaction_id:'TRADE1',type:'trade',status:'complete',created:1700000000000,roster_ids:[2,3],adds:{p1:2,p2:3}},
    {transaction_id:'FREE1',type:'free_agent',status:'complete',created:1700000001000,roster_ids:[4],adds:{p3:4}}]);
    cb?.({done:19,total:19,failures:1});return m;
  }
};

const VAULT_CONFIG={FAIR_PCT:14,LOPSIDED_PCT:41};
const marketOverpay=()=>new Map();
const four=Array.from({length:4},(_,i)=>({rosterId:i+1,teamName:'Team '+(i+1),username:'manager'+(i+1),record:{wins:4+i,losses:8-i}}));
const graded=Array.from({length:31},(_,i)=>({
 tx:{transaction_id:'G'+i,roster_ids:[1,2]},
 teamA:{rosterId:1,teamName:'Team 1'},teamB:{rosterId:2,teamName:'Team 2'},
 created:1700000000000+i*500000, bucket:'fair',fairness:{overallPct:5,fitMovedIt:false},
 toA:[{name:'Player A'}],toB:[{name:'Player B'}],pctDiff:5,
 dValueAdjAToday:100,anyMissingValue:false
}));
const tradeRecords=graded.map(g=>({transaction_id:g.tx.transaction_id,roster_ids:[1,2],priced:true}))
 .concat([{transaction_id:'UNPRICED',roster_ids:[3,4],priced:false}]);
const reportStats=four.map((t,i)=>({
 ...t,trades:i<2?31:1,pricedTrades:i<2?31:0,
 won:0,wonNow:0,lost:0,lostNow:0,
 netValue:i<2?100:0,netValueToday:i<2?120:0,avgFit:0,fitTrades:0,
 fair:0,lopsided:0,unfair:0,fairNow:0,lopsidedNow:0,unfairNow:0,best:null,worst:null
}));
Object.assign(Vault,{
 getMyTeamId:()=>1,myTeam:teams=>teams[0],info:()=>'',term:(_,label)=>label,
 signed:(v,fn)=>v>0?'+'+fn(v):v<0?'-'+fn(-v):'0',
 managerProfile:()=>({style:'Observing',tone:'neutral',blurb:'Not enough priced trades to claim a trading tendency.'}),
 managerTendencyNotes:()=>[],
 gradedImprovement:()=>({tier:'slight',level:'tossup',label:'Toss-up'}),
 VERDICT_TIER_TEXT:{slight:'text-emerald-300'},BUCKET_STYLE:{Fair:{text:'text-amber-200'}},
 priceWord:b=>b==='fair'?'Fair':b,fairnessBucket:()=> 'Fair',
 popupOpen:()=>false,seasonReport:async()=>null,markOutOfRace:()=>false,
 fetchAndGradeAllTrades:async()=>({league:{name:'Fixture League'},isSF:true,teams:four,allGraded:graded,
   tradeActivity:tradeRecords,pendingTrades:[],weekErrors:[{season:'2025',weeks:[8]}],slots:[],remainingWeeks:[]}),
 buildManagerStats:()=>reportStats
});`;
async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const server=http.createServer((req,res)=>{
    try{
      const route=decodeURIComponent((req.url||'/').split('?')[0]),target=path.resolve(ROOT,'.'+route);
      if(!target.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return}
      const ext=path.extname(target);
      res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[ext]||'text/plain'});
      res.end(fs.readFileSync(target));
    }catch(e){if(!res.headersSent)res.writeHead(404);res.end()}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    for(const width of [320,390,768,1280]){
      const page=await browser.newPage({viewport:{width,height:850}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/vault-core.js*',r=>r.fulfill({body:fixture,contentType:'text/javascript'}));
      await page.route('**/vault-nav.js*',r=>r.fulfill({body:"document.getElementById('vault-nav').textContent='The Vault';",contentType:'text/javascript'}));
      await page.route('**/market-data.js*',r=>r.fulfill({body:'',contentType:'text/javascript'}));
      await page.route('**/player-card.js*',r=>r.fulfill({body:'',contentType:'text/javascript'}));
      await page.route('**/season-report.js*',r=>r.fulfill({body:'',contentType:'text/javascript'}));
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,r=>r.abort());
      await page.goto(origin+'/draft.html?league_id=123',{waitUntil:'domcontentloaded'});
      await page.locator('#draftContent:not(.hidden)').waitFor();
      assert.equal(await page.locator('#orderRows tr').count(),6);
      const firstPickCount=width<640?6:12;
      assert.equal(await page.locator('#pickRows tr').count(),firstPickCount);
      if(width<640){
        assert.equal(await page.locator('#pickRows td[data-label="Current holder"]').count(),firstPickCount);
        assert.equal(await page.locator('#orderRows td[data-label="Placement basis"]').count(),6);
        assert.equal(await page.locator('#pickRows tr').first().evaluate(el=>getComputedStyle(el).display),'grid','Draft rows must be mobile cards '+width);
        const field=await page.locator('#pickRows td[data-label="Current holder"]').first().boundingBox();
        assert.ok(field&&field.x+field.width<=width+2,'Current pick owner is clipped '+width);
      }
      if(width<640){
        await page.locator('#morePicks').click();
        assert.equal(await page.locator('#pickRows tr').count(),12,'Draft pick pagination at '+width);
      }
      await page.locator('#roundStyle').selectOption('3rr');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Draft overflow '+width);
      await page.screenshot({path:path.join(OUT,'draft-'+width+'.png'),fullPage:true});
      await page.goto(origin+'/activity.html?league_id=123',{waitUntil:'domcontentloaded'});
      await page.locator('#activityBody:not(.hidden)').waitFor();
      assert.equal(await page.locator('.vault-event-card').count(),3);
      assert.ok((await page.locator('#coverage').innerText()).includes('Missing weeks: 8'));
      await page.locator('#activityTeam').selectOption('2');
      assert.equal(await page.locator('.vault-event-card').count(),1);
      await page.locator('#activityTeam').selectOption('4');
      assert.equal(await page.locator('.vault-event-card').count(),1);
      // A failed historical season must not hide the selector needed to recover.
      await page.locator('#activitySeason').selectOption('122');
      await page.locator('#loadError:not(.hidden)').waitFor();
      assert.ok(await page.locator('#activitySeason').isVisible(),'Season selector hidden during failure '+width);
      await page.locator('#activitySeason').selectOption('123');
      await page.locator('#activityBody:not(.hidden)').waitFor();
      await page.locator('#activitySeason').selectOption('122');
      await page.locator('#activityBody:not(.hidden)').waitFor();
      const teamHref=await page.locator('.vault-event-team a').first().getAttribute('href');
      const gradeHref=await page.locator('.vault-event-detail').first().getAttribute('href');
      assert.ok(teamHref.includes('league_id=122'),'Historical team points at wrong season: '+teamHref);
      assert.ok(gradeHref.includes('league_id=123'),'Historical grade should search current dynasty chain: '+gradeHref);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Activity overflow '+width);
      await page.screenshot({path:path.join(OUT,'activity-'+width+'.png'),fullPage:true});
      // Managers must show raw and priced trades distinctly, with keyboard
      // expand/collapse and no invented zero for unpriced manager performance.
      await page.goto(origin+'/managers.html?league_id=123',{waitUntil:'domcontentloaded'});
      await page.locator('#tradeEvidence:not(.hidden)').waitFor();
      assert.ok((await page.locator('#tradeEvidence').innerText()).includes('31'),'Evidence strip hides priced trades '+width);
      assert.equal(await page.locator('#manager-toggle-4').count(),1);
      const fourth=page.locator('#manager-toggle-4');
      const tableRow=await fourth.evaluate(el=>el.closest('tr').innerText);
      assert.ok(tableRow.includes('—'),'Unpriced manager incorrectly receives a zero net '+width+': '+tableRow);
      await fourth.focus();await fourth.press('Enter');
      assert.equal(await page.locator('#manager-toggle-4').getAttribute('aria-expanded'),'true');
      const detail=await page.locator('#manager-detail-4 > td > div').boundingBox();
      assert.ok(detail&&detail.x+detail.width<=width+2,'Manager detail panel clipped '+width);
      assert.equal(await page.locator('#manager-toggle-4').evaluate(el=>document.activeElement===el),true,'Manager focus not restored '+width);
      await page.locator('#manager-sort-netValue').click();
      assert.equal(await page.locator('#manager-sort-netValue').evaluate(el=>document.activeElement===el),true,'Sort focus not restored '+width);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Managers overflow '+width);
      await page.screenshot({path:path.join(OUT,'managers-'+width+'.png'),fullPage:true});
      // Grades list only priceable deals, progressively revealing old trades;
      // each manager filter receives the same complete-price rule.
      await page.goto(origin+'/trade_grades.html?league_id=123',{waitUntil:'domcontentloaded'});
      await page.locator('#tradeEvidence:not(.hidden)').waitFor();
      assert.ok((await page.locator('#status').innerText()).includes('31 reliably graded of 32'));
      const gradeSize=width<640?12:30;
      assert.equal(await page.locator('#list > button').count(),gradeSize,'Trade Grades first page count '+width);
      await page.locator('#moreGrades').click();
      assert.equal(await page.locator('#list > button').count(),Math.min(31,gradeSize*2),'Show more must expose next page '+width);
      await page.locator('#teamFilterBar select').selectOption('4');
      assert.ok(await page.locator('#empty').isVisible(),'Unpriced manager should not receive fake grades '+width);
      await page.locator('#teamFilterBar select').selectOption('');
      assert.equal(await page.locator('#list > button').count(),gradeSize,'Changing filter resets pagination '+width);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Grades overflow '+width);
      await page.screenshot({path:path.join(OUT,'grades-'+width+'.png'),fullPage:true});
      assert.deepEqual(errors,[],'Browser JavaScript errors '+width);
      await page.close();console.log('PASS Chromium at '+width+'px: draft, activity, evidence parity, keyboard managers, paginated grades and no overflow');
    }
  }finally{await browser.close();await new Promise(r=>server.close(r))}
}
main().catch(e=>{console.error(e);process.exitCode=1});
