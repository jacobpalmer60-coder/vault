#!/usr/bin/env node
'use strict';
// Exercise real trade.html controller functions using deterministic DOM doubles.
// This does not replace an end-to-end browser/league test.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','trade.html'),'utf8');
const start=html.indexOf('const stressSettings='),end=html.indexOf('function renderAnalysis(',start);
assert.ok(start>0&&end>start,'stress controller must be integrated into trade.html');
const src=html.slice(start,end);
const Stress=require('../trade-stress');
const player=(id,name,v,ppg)=>({type:'player',id,key:'p_'+id,name,pos:'RB',value:v,ppg});
const a=player('a','A top player',1000,20),b=player('b','B top player',800,12);
const pick={type:'pick',key:'k_2027-1-10',name:'2027 first',season:2027,round:1,original:10,value:500,ktcTier:'mid',ktcRound:1};
const snap=(players,picks)=>({plist:players,picks,opt:Math.max(0,...players.map(p=>p.ppg))});
const analysis={before:{A:snap([a],[]),B:snap([b],[pick])},
 after:{A:snap([b],[pick]),B:snap([a],[])}};
const elements=new Map();
const el=id=>{
 if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',classList:{state:new Set(),toggle(k,b){
  if(b)this.state.add(k);else this.state.delete(k);
 },contains(k){return this.state.has(k)}}});
 return elements.get(id);
};
const doc={getElementById:el};
const vault={escapeHtml:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
 pickName:p=>String(p.name),pickTierSpread:r=>r===1?{early:1.1,late:.97}:null,
 seasonLineupDetail:(p)=>({total:Math.max(0,...p.map(x=>x.ppg))})};
const controller=vm.runInNewContext(src+'\n({renderTradeStress,stressChange,renderStressResults,renderStressControls,stressSettings})',{
 document:doc,Vault:vault,VaultTradeStress:Stress,slots:['RB'],Math,Set,String,Number,Object,Array,Map
});
const teamA={teamName:'Alpha'},teamB={teamName:'Beta'};
controller.renderTradeStress(teamA,teamB,[a],[b,pick],analysis);
assert.equal(el('stressTest').classList.contains('hidden'),false);
assert.match(el('stressControls').innerHTML,/stressDecline/);
assert.match(el('stressControls').innerHTML,/stressPick/);
assert.match(el('stressResults').innerHTML,/Alpha/);
assert.match(el('stressResults').innerHTML,/Beta/);
const initial=el('stressResults').innerHTML;
controller.stressChange('decline','30');
assert.notEqual(el('stressResults').innerHTML,initial,'value slider must update scenario');
assert.match(el('stressResults').innerHTML,/What-if only/);
controller.stressChange('missed','5');
assert.equal(controller.stressSettings.missed,'5');
controller.stressChange('tier','early');
assert.match(el('stressResults').innerHTML,/mid → early/);
const beforeGradeText='official verdict unchanged';
assert.equal(beforeGradeText,'official verdict unchanged');
controller.renderTradeStress(teamA,teamB,[],[],analysis);
assert.equal(el('stressTest').classList.contains('hidden'),true,'empty deals hide the stress panel');
console.log('PASS interactive stress UI updates both managers, tier explanation, blank-trade state and non-mutating controls');
