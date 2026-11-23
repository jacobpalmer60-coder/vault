#!/usr/bin/env node
'use strict';
// Screenshot-based deterministic audit: Nov 22, 2026 SF with TE premium.
// This protects the actual arithmetic, A/B symmetry and the disclosure.
// It does NOT validate Vault's fair-curve parameters against future outcomes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {loadVault}=require('./lib-market');
const Policy=require('../trade-policy'),UI=require('../trade-price-audit-ui');
const Vault=loadVault();
Vault.setGradeMarket({updated:'2026-11-22T15:04:18Z',formats:{sf_tep:{
 'n:corey kiner':-6.1,'n:george kittle':-1.7
}}},true,0.5);
const player=(name,value,pos)=>({name,key:'n:'+name.toLowerCase(),type:'player',pos,value});
const boston=player('Denzel Boston',4472,'WR'),kiner=player('Corey Kiner',1984,'RB');
const kittle=player('George Kittle',4524,'TE');
const A=[boston,kiner],B=[kittle],original=JSON.stringify({A,B});
const actual=Policy.priceAudit(Vault,A,B),swapped=Policy.priceAudit(Vault,B,A);
const close=(got,want,eps=0.08)=>assert.ok(Math.abs(got-want)<eps,got+' not within '+eps+' of '+want);
close(actual.listed.signedPct,35.1913);
close(actual.market.signedPct,35.019);
close(actual.package.signedPct,1.37985);
close(actual.ktc.signedPct,33.6591);
close(actual.package.bonusB,1801.0695,0.2);
close(actual.marginal.marketPrice,1862.976,0.02);
close(actual.marginal.equivalent,36.882,0.2);
close(actual.marginal.retainedPct,1.9797,0.06);
assert.equal(actual.marginal.assetName,'Corey Kiner');
assert.equal(actual.marginal.sendSide,'A');
assert.equal(actual.materialDisagreement,true);
assert.ok(actual.divergencePct>33&&actual.divergencePct<34);
assert.equal(JSON.stringify({A,B}),original,'audit cannot mutate assets');
for(const k of ['listed','market','package','ktc']){
 close(actual[k].signedPct,-swapped[k].signedPct,1e-7);
 close(actual[k].valueA,swapped[k].valueB,1e-7);
 close(actual[k].valueB,swapped[k].valueA,1e-7);
}
close(actual.marginal.equivalent,swapped.marginal.equivalent,1e-7);
assert.equal(swapped.marginal.sendSide,'B');
console.log('PASS Boston/Kiner-for-Kittle: 35% additive, 1.4% package, 33.7% KTC, 2% marginal; A/B symmetry');

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const names={teamName:'Skat Pack'},opponent={teamName:'TURBONUTZ'};
const html=UI.html(actual,names,opponent,esc);
assert.match(html,/Large pricing-model disagreement \(34 percentage points\)/);
assert.match(html,/35\.0%/);
assert.match(html,/1\.4%/);
assert.match(html,/Corey Kiner/);
assert.match(html,/1\.9%|2\.0%/);
assert.match(html,/Market prices added/);
assert.match(html,/KTC-calculator approximation/);
assert.match(html,/Skat Pack sends/);
assert.match(html,/TURBONUTZ sends/);
assert.match(html,/not four\s+independent price surveys/);
assert.match(html,/model|historical|not.*actual trade price/s);
assert.ok(!html.includes('real trades pay about'),'must not misrepresent fitted curve as directly observed price');
const reverseHtml=UI.html(swapped,opponent,names,esc);
assert.match(reverseHtml,/favors TURBONUTZ/,'A/B display uses the receiver not sender');
const escaped=UI.html(actual,{teamName:'<svg onload=alert(1)>'},opponent,esc);
assert.ok(!escaped.includes('<svg'),'team names are escaped');
console.log('PASS visible divergence warning, price table, receiver labels and escaping');

const one=Policy.priceAudit(Vault,[boston],[kittle]);
assert.equal(one.marginal,null);
assert.equal(one.materialDisagreement,false);
assert.ok(!UI.html(one,names,opponent,esc).includes('Large pricing-model disagreement'));
assert.ok(UI.html(one,names,opponent,esc).includes('Compare how the pricing methods'));
assert.equal(UI.html(null,names,opponent,esc),'');
console.log('PASS one-for-one parity and no false warnings');

const trade=fs.readFileSync(path.join(__dirname,'..','trade.html'),'utf8');
assert.ok(trade.includes('VaultTradePolicy.priceAudit(Vault, aAssets, bAssets)'));
assert.ok(trade.includes('VaultPriceAuditUI.html(prices, teamA, teamB, Vault.escapeHtml)'));
assert.ok(trade.includes('Primary market-price grade'));
assert.ok(trade.includes('Legacy package curve'));
assert.ok(trade.includes('trade-price-audit-ui.js'));
assert.ok(!trade.includes('Market fairness</div>'),'do not relabel model price as additive market fairness');
assert.ok(trade.includes('marketBucket'),'apply shared price tiers to the new additive basis');
assert.ok(trade.includes('marketFeedAvailable'),'identify KTC fallback if trade-premium feed is missing');
assert.ok(trade.includes('even market price'),'price summary must name the additive basis');
console.log('PASS calculator wiring and model labeling');
