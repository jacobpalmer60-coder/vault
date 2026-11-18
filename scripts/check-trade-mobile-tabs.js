#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','trade.html'),'utf8');
const tabs=['verdict','teams','stress','season','details'],targets=['tradeAnswer','teamImpact','stressTest','seasonWrap','tradeDetails'];
tabs.forEach((t,i)=>{
 assert.ok(html.includes('data-tt="'+t+'" aria-selected="'),t+' tab exists');
 assert.ok(html.includes('aria-controls="'+targets[i]+'"'),t+' maps to real panel');
 assert.ok(html.includes('id="'+targets[i]+'"'),t+' controlled element exists');
});
assert.ok(html.includes('role="tablist"'),'screen reader tablist present');
assert.ok(html.includes('teamImpactLedgerHtml(impactBySide[side])'),'both side cards share impact facts');
assert.ok(html.includes('VaultTradeImpact.explain(impactBySide[side], res.mode)'),'both team explanations share function');
const begin=html.indexOf('function tradeTab(tab) {'),end=html.indexOf('function fillQuickAdd()',begin);
assert.ok(begin>0&&end>begin,'phone tab controller exists');
const blocks=html.slice(begin,end);
const buttons=tabs.map(tt=>({
 dataset:{tt},attributes:{},
 setAttribute(k,v){this.attributes[k]=v;},
 tabIndex:-1,focus(){document.activeElement=this}
}));
const panel={dataset:{tab:'verdict'}},stress={open:false},season={open:false},details={open:false},listeners={};
const document={
 activeElement:buttons[0],
 getElementById(id){return ({tradeBar:panel,tradeTabs:{addEventListener:(event,cb)=>{listeners[event]=cb}},stressWrap:stress,seasonWrap:season,tradeDetails:details})[id]},
 querySelectorAll(selector){assert.equal(selector,'#tradeTabs [role="tab"]');return buttons}
};
const ctx=vm.createContext({document});
vm.runInContext(blocks,ctx);
ctx.tradeTab('teams');
assert.equal(panel.dataset.tab,'teams');
assert.equal(buttons[1].attributes['aria-selected'],'true');
assert.equal(buttons[0].tabIndex,-1);
assert.equal(buttons[1].tabIndex,0);
ctx.tradeTab('stress');assert.equal(stress.open,true,'What-if scenario panel expands');
ctx.tradeTab('season');assert.equal(season.open,true,'season view expands');
ctx.tradeTab('details');assert.equal(details.open,true,'details view expands');
const before=panel.dataset.tab;ctx.tradeTab('invalid');assert.equal(panel.dataset.tab,before,'invalid tab ignored');
buttons[0].focus();
let prevented=0;
listeners.keydown({key:'ArrowRight',preventDefault(){prevented++}});
assert.equal(panel.dataset.tab,'teams');
assert.equal(document.activeElement,buttons[1]);
listeners.keydown({key:'End',preventDefault(){prevented++}});
assert.equal(panel.dataset.tab,'details');
listeners.keydown({key:'ArrowRight',preventDefault(){prevented++}});
assert.equal(panel.dataset.tab,'verdict','arrow wraps');
listeners.keydown({key:'ArrowLeft',preventDefault(){prevented++}});
assert.equal(panel.dataset.tab,'details','left arrow wraps');
assert.equal(prevented,4);
console.log('PASS phone tabs including What-if, keyboard focus, arrow wrapping, disclosure panels, both-side explanations');
