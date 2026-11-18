#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {slotsForDraft}=require('./market-history/rookie-slot');
const draft=(size,rounds=2)=>Array.from({length:size*rounds},(_,i)=>[i+1,Math.floor(i/size)+1,'p'+(i+1)]);
for(const size of [8,10,12,14,16]){
 const res=slotsForDraft(draft(size));
 assert.equal(res.reason,'ok');
 assert.equal(res.slots.length,size*2);
 assert.equal(res.slots.find(p=>p.round===1&&p.slot===1).overall,1);
 assert.equal(res.slots.find(p=>p.round===1&&p.slot===size).overall,size);
 assert.equal(res.slots.find(p=>p.round===2&&p.slot===1).overall,size+1);
 assert.equal(res.slots.find(p=>p.round===2&&p.slot===size).overall,size*2);
 assert.equal(res.slots[0].draftSize,size);
}
assert.equal(slotsForDraft(draft(7)).reason,'unknown-draft-size');
assert.equal(slotsForDraft(draft(17)).reason,'unknown-draft-size');
assert.equal(slotsForDraft(draft(12).filter(p=>p[0]!==4)).reason,'unknown-draft-size');
assert.equal(slotsForDraft(draft(12).map(p=>p[0]===4?[3,1,p[2]]:p)).reason,'incomplete-first-round');
const partial=slotsForDraft(draft(12).filter(p=>p[0]!==15));
assert.equal(partial.reason,'ok');
assert.equal(partial.slots.length,12,'incomplete second round never contributes');
const shuffled=draft(10).reverse();
const ranked=slotsForDraft(shuffled);
assert.equal(ranked.slots.find(p=>p.round===1&&p.slot===1).sid,'p1','array order must not define slot');
assert.equal(ranked.slots.find(p=>p.round===2&&p.slot===1).sid,'p11');
const forged=draft(10).map(p=>p[0]===11?[101,2,p[2]]:p);
assert.equal(slotsForDraft(forged).slots.length,10,'nonconsecutive second round rejected');
console.log('PASS slot sizes, overall numbering, incomplete rounds, reverse order and malformed drafts');
