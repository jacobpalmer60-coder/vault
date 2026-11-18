#!/usr/bin/env node
'use strict';
/*
 Browser exercise for both sides of a real populated Vault trade.
 Start local site: npx serve -l 5191 .
 Install browser driver: npm i --no-save puppeteer-core
 Run: node scripts/smoke-trade-flow.js <Sleeper league ID>
 Optionally set BASE, CHROME, SHOTS (screenshot destination).
 This opens the REAL calculator; it does not fake server responses.
 */
const fs=require('node:fs'),path=require('node:path');
const puppeteer=require('puppeteer-core');
const leagueId=process.argv[2];
const base=process.env.BASE||'http://localhost:5191';
const browserPath=process.env.CHROME||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/google-chrome',
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p=>fs.existsSync(p));
if(!leagueId||!browserPath){console.error('Usage: node scripts/smoke-trade-flow.js <leagueId> (set CHROME if necessary)');process.exit(2)}
const sizes=[['desktop',1280,900],['phone',375,812],['small-phone',320,700]];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await puppeteer.launch({executablePath:browserPath,headless:true});
 let failures=0;
 try{
  for(const [name,width,height] of sizes){
   const page=await browser.newPage();
   const errors=[];
   page.on('pageerror',e=>errors.push('page error: '+e.message));
   await page.setViewport({width,height,deviceScaleFactor:1,isMobile:width<600,hasTouch:width<600});
   try{
    await page.goto(base+'/trade.html?league_id='+encodeURIComponent(leagueId),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>typeof teams!=='undefined'&&teams.length>=2&&teams.some(t=>t.assets?.length),{timeout:60000});
    const prepared=await page.evaluate(()=>{
      if(!document.getElementById('setup').classList.contains('hidden')){
        document.getElementById('loadRostersBtn').click();
      }
      const options=teams.filter(t=>t.assets.some(a=>a.type==='player'&&a.value>0));
      if(options.length<2)return {error:'Not enough teams with priced players'};
      const [a,b]=options;
      const selA=document.getElementById('teamA'),selB=document.getElementById('teamB');
      selA.value=String(a.rosterId);selA.dispatchEvent(new Event('change'));
      selB.value=String(b.rosterId);selB.dispatchEvent(new Event('change'));
      const aa=a.assets.find(x=>x.type==='player'&&x.value>0);
      const bb=b.assets.find(x=>x.type==='player'&&x.value>0);
      if(!aa||!bb)return {error:'No priced trade assets'};
      selectedA.add(aa.key);selectedB.add(bb.key);
      updateTrade();
      return {A:a.teamName,B:b.teamName};
    });
    if(prepared.error)errors.push(prepared.error);
    if(!errors.length){
      if(width<600)await page.evaluate(()=>tradeTab('teams'));
      await delay(250);
      const report=await page.evaluate(()=>{
        const visible=id=>{const el=document.getElementById(id);return !!el&&!el.classList.contains('hidden')&&el.getClientRects().length>0};
        const text=id=>document.getElementById(id)?.innerText||'';
        const a=text('analysisA'),b=text('analysisB');
        const labels=['Roster impact','What changes for this team','Lineup PPG','Draft capital (today)','Player value','Total team value'];
        const missing=labels.filter(label=>!a.includes(label)||!b.includes(label));
        return {visibleA:visible('analysisA'),visibleB:visible('analysisB'),
          missing,wide:document.documentElement.scrollWidth-innerWidth,
          aTeam:a.slice(0,100),bTeam:b.slice(0,100)};
      });
      if(!report.visibleA||!report.visibleB)errors.push('one trade-side card is not visible');
      if(report.missing.length)errors.push('missing impact labels in both cards: '+report.missing.join(', '));
      if(report.wide>1)errors.push('trade is '+report.wide+'px wider than '+width+'px viewport');
      const stressReport=await page.evaluate(()=>{
        if(innerWidth<600)tradeTab('stress');
        else document.getElementById('stressWrap').open=true;
        const gradeBefore=document.getElementById('diffLabel')?.innerText||'';
        const tradeBefore=JSON.stringify({A:[...selectedA].sort(),B:[...selectedB].sort()});
        const coachBefore=typeof negContext==='undefined'?null:JSON.stringify(negContext);
        const evenBefore=typeof evenFix==='undefined'?null:JSON.stringify({at:evenFix?.at,baseA:evenFix?.baseA,baseB:evenFix?.baseB,nowA:evenFix?.nowA,nowB:evenFix?.nowB});
        const defaultStress=document.getElementById('stressResults')?.innerText||'';
        stressChange('decline','30');
        stressChange('missed','4');
        const panel=document.getElementById('stressResults');
        const output=panel?.innerText||'';
        const visible=!!panel?.getClientRects().length;
        const changedScenario=output!==defaultStress;
        const controls=document.getElementById('stressControls')?.innerText||'';
        const declineLabel=document.getElementById('stressDeclineLabel')?.textContent;
        const missedLabel=document.getElementById('stressMissedLabel')?.textContent;
        const gradeAfter=document.getElementById('diffLabel')?.innerText||'';
        return {visible,both:output.includes(preparedTeamName('A'))&&output.includes(preparedTeamName('B')),
          declared:output.includes('What-if only')&&output.includes('Trade impact'),
          gradeSame:gradeBefore===gradeAfter,
          changedScenario,
          scenarioLabelsCorrect:declineLabel==='30%'&&missedLabel==='4',
          exposesBothAssumptions:controls.includes('Player exposed to downside')&&output.includes('Official grading and Trade Coach are unaffected'),
          tradeSame:tradeBefore===JSON.stringify({A:[...selectedA].sort(),B:[...selectedB].sort()}),
          coachSame:coachBefore===(typeof negContext==='undefined'?null:JSON.stringify(negContext)),
          evenSame:evenBefore===(typeof evenFix==='undefined'?null:JSON.stringify({at:evenFix?.at,baseA:evenFix?.baseA,baseB:evenFix?.baseB,nowA:evenFix?.nowA,nowB:evenFix?.nowB})),
          overshoot:document.documentElement.scrollWidth-innerWidth};
        function preparedTeamName(side){return teamOf(side).teamName}
      });
      if(!stressReport.visible||!stressReport.both||!stressReport.declared)
       errors.push('What-if scenario does not show the full two-manager analysis');
      if(!stressReport.gradeSame)errors.push('What-if scenario changed the official verdict');
      if(!stressReport.changedScenario)errors.push('What-if controls did not change the results');
      if(!stressReport.scenarioLabelsCorrect)errors.push('What-if labels did not reflect requested inputs');
      if(!stressReport.exposesBothAssumptions)errors.push('What-if assumptions and grading separation not visible');
      if(!stressReport.tradeSame)errors.push('What-if scenario mutated the assets selected for trade');
      if(!stressReport.coachSame)errors.push('What-if scenario mutated Trade Coach negotiation state');
      if(!stressReport.evenSame)errors.push('What-if scenario mutated Even It Out state');
      if(stressReport.overshoot>1)errors.push('What-if scenario overflows by '+stressReport.overshoot+'px');
      if(width<600){
       for(const tab of ['teams','stress','season','details','verdict']){
        await page.evaluate(t=>tradeTab(t),tab);
        const state=await page.evaluate(t=>({
          selected:document.querySelector('#tradeTabs [data-tt="'+t+'"]')?.getAttribute('aria-selected'),
          current:document.getElementById('tradeBar')?.dataset.tab,
          wide:document.documentElement.scrollWidth-innerWidth
        }),tab);
        if(state.current!==tab||state.selected!=='true')errors.push('mobile tab '+tab+' did not activate correctly');
        if(state.wide>1)errors.push('horizontal overflow in mobile tab '+tab);
       }
      }
      if(process.env.SHOTS){
       fs.mkdirSync(process.env.SHOTS,{recursive:true});
       await page.screenshot({path:path.join(process.env.SHOTS,'trade-'+name+'.png'),fullPage:true});
      }
    }
   }catch(e){errors.push(String(e.message||e).slice(0,220))}
   if(errors.length){failures++;console.log('FAIL '+name);errors.forEach(e=>console.log('  '+e))}
   else console.log('PASS '+name+' both teams, impact ledger, and responsive tabs');
   await page.close();
  }
 }finally{await browser.close()}
 console.log(failures?failures+' viewport(s) failed':'All three trade viewport scenarios passed');
 process.exit(failures?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
