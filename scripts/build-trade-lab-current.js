#!/usr/bin/env node
'use strict';
// Rebuild factual, current collection statistics for Trade Lab from the
// six published per-format market summaries. This DOES NOT replace
// historical/predictive local VaultValues research in trade-lab.json.
// No manager/league identifiers, roster details or private snapshots are read.
const fs = require('node:fs'), path = require('node:path');
const ROOT = process.env.VAULT_LAB_DATA_ROOT || path.join(__dirname, '..', 'data');
const DIR = path.join(ROOT, 'market-history');
const FORMATS = ['sf','sf_tep','sf_tepp','oneQB','oneQB_tep','oneQB_tepp'];
const sum = (o, k, n) => { o[k] = (o[k] || 0) + n; };
function build() {
  const formats = {}, years = {}, shapes = {};
  const updated = [];
  for (const format of FORMATS) {
    const source = path.join(DIR, format + '.json');
    if (!fs.existsSync(source)) throw new Error('Missing pricing format '+format+'; refusing incomplete Trade Lab snapshot');
    const d = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (d.format !== format || !d.updated || !d.trades || !d.years)
      throw new Error('Incomplete price summary for '+format);
    if (!(Number.isInteger(d.trades.crawled) && Number.isInteger(d.trades.priced)) ||
        d.trades.priced < 0 || d.trades.priced > d.trades.crawled)
      throw new Error('Invalid trade counts for '+format);
    formats[format] = { crawled:d.trades.crawled, priced:d.trades.priced, leagues:d.leagues };
    updated.push(d.updated);
    for (const [year, r] of Object.entries(d.years)) {
      if (!/^\d{4}$/.test(year) || !r || !Number.isInteger(r.n) || r.n < 0)
        throw new Error('Invalid yearly aggregate for '+format+' '+year);
      sum(years,year,r.n);
      for (const [shape, vals] of Object.entries(r.shapes || {})) {
        const count=vals?.[0];
        if (!Number.isInteger(count) || count < 0) throw new Error('Invalid shape count '+shape);
        sum(shapes,shape,count);
      }
    }
  }
  const crawled=Object.values(formats).reduce((n,f)=>n+f.crawled,0);
  const priced=Object.values(formats).reduce((n,f)=>n+f.priced,0);
  // This date is the oldest underlying summary, never today's build timestamp
  // when one source is stale. The UI can honestly warn on stale market facts.
  const sourceUpdated=updated.sort()[0];
  const out={schemaVersion:1,sourceUpdated,crawled,priced,formats,
    years:Object.fromEntries(Object.entries(years).sort(([a],[b])=>a.localeCompare(b))),
    shapes:Object.fromEntries(Object.entries(shapes).sort((a,b)=>b[1]-a[1])),
    scope:'Completed Sleeper trade-market summaries; no acceptance probabilities or manager-level data',
    historicalResearchUpdatedSeparately:true};
  if (!priced || Object.values(years).reduce((a,b)=>a+b,0)!==priced)
    throw new Error('Pricing cohort totals are inconsistent; keeping last-good Trade Lab current facts');
  const file=path.join(DIR,'trade-lab-current.json');
  const temp=file+'.tmp-'+process.pid;
  try {fs.writeFileSync(temp,JSON.stringify(out));fs.renameSync(temp,file)}
  finally {if(fs.existsSync(temp))fs.unlinkSync(temp)}
  console.log('Trade Lab current facts:',priced,'priced of',crawled,'crawled; oldest source',sourceUpdated);
  return out;
}
if(require.main===module)build();
module.exports={build};
