#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {capture}=require('./market-history/prospective-prices');
const {DATA}=require('./market-history/ktc-book');
const sha=process.argv[2],dir=process.argv[3];
if(!dir)throw Error('Usage: node scripts/capture-prospective-prices.js SOURCE_SHA OUTPUT_DIR');
const read=name=>JSON.parse(fs.readFileSync(path.join(DATA,name),'utf8'));
const snap=capture(read('ktc-values.json'),read('grade-values.json'),sha);
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'prices-'+snap.capturedAt.slice(0,10)+'.json.gz');
fs.writeFileSync(file,zlib.gzipSync(JSON.stringify(snap)),{flag:'wx'});
console.log(file);
