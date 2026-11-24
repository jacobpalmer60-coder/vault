#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vault-live-lab-test-'));
process.env.VAULT_LAB_DATA_ROOT=tmp;
const {build}=require('./build-trade-lab-current');
const DIR=path.join(tmp,'market-history');fs.mkdirSync(DIR,{recursive:true});
const formats=['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'];
try {
  formats.forEach((format,i)=>fs.writeFileSync(path.join(DIR,format+'.json'),JSON.stringify({
    format,updated:i===3?'2026-11-19T00:00:00Z':'2026-11-24T18:00:00Z',
    leagues:10,trades:{crawled:30,priced:20},years:{'2025':{n:4,shapes:{'1-for-1':[4,0,null]}},
      '2026':{n:16,shapes:{'1-for-1':[12,0,null],'1-for-2':[4,0,0]}}}
  })));
  const a=build();
  assert.equal(a.crawled,180);assert.equal(a.priced,120);
  assert.equal(a.years['2025'],24);assert.equal(a.years['2026'],96);
  assert.equal(a.shapes['1-for-1'],96);
  assert.equal(a.sourceUpdated,'2026-11-19T00:00:00Z','stale format must not get current timestamp');
  assert.equal(Object.keys(a.formats).length,6);
  const previous=fs.readFileSync(path.join(DIR,'trade-lab-current.json'),'utf8');
  fs.unlinkSync(path.join(DIR,'oneQB_tepp.json'));
  assert.throws(build,/Missing pricing format/);
  assert.equal(fs.readFileSync(path.join(DIR,'trade-lab-current.json'),'utf8'),previous,'invalid partial refresh cannot overwrite last good');
  console.log('PASS current Trade Lab facts sum all formats, retain oldest source date, exclude private manager data and survive partial updates');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
