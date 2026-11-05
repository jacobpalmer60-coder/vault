/* ============================================================
   CRAWL GUARD
   The crawled trades live only as release assets, each run downloads them, adds to
   them and uploads them over the old ones, and GitHub keeps no earlier versions. So a run
   that started without a season's file rebuilt it from nothing and saved that over the real
   one: 2026 fell from 1.43 million trades to 3,126 on 2026-11-04, and 2021-23 from about 1.5
   million to 540,000 a few days earlier. This stops the run instead.

   node scripts/crawl-guard.js check          after download: every season the last published
                                              stats list is here and hasn't shrunk (fails the job)
   node scripts/crawl-guard.js mark <file>    write each season's trade count
   node scripts/crawl-guard.js same <file>    before upload: nothing fell below those counts
   node scripts/crawl-guard.js merge <dir>    add a restore folder's seasons to the local files,
                                              keeping every trade from both (see crawl-sleeper.yml)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'sleeper-trades');
const STATS = path.join(ROOT, 'data', 'market-history', 'crawl-stats.json');
const MIN_TRADES = 1000, KEEP = 0.95; // stats are a run old, so a small drop isn't damage, but nothing should shrink much

const read = f => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
const counts = () => Object.fromEntries((fs.existsSync(OUT) ? fs.readdirSync(OUT) : []).filter(f => /^\d{4}\.json\.gz$/.test(f)).map(f => [f.slice(0, 4), Object.keys(read(path.join(OUT, f)).trades || {}).length]));
const fail = msg => { console.error(`crawl guard: ${msg}`); process.exit(1); };

const [mode, arg] = process.argv.slice(2);
if (mode === 'check') {
  const stats = fs.existsSync(STATS) ? JSON.parse(fs.readFileSync(STATS, 'utf8')) : { seasons: {} };
  const now = counts();
  for (const [season, s] of Object.entries(stats.seasons || {})) {
    if (s.trades < MIN_TRADES) continue;
    if (now[season] == null) fail(`${season}.json.gz didn't download; stopping so it isn't rebuilt from nothing`);
    if (now[season] < s.trades * KEEP) fail(`${season} has ${now[season]} trades, down from ${s.trades}; stopping so it isn't saved over`);
  }
  console.log('crawl guard: all seasons here', JSON.stringify(now));
} else if (mode === 'mark') {
  fs.writeFileSync(arg, JSON.stringify(counts()));
} else if (mode === 'same') {
  const before = JSON.parse(fs.readFileSync(arg, 'utf8')), now = counts();
  for (const [season, n] of Object.entries(before)) if ((now[season] ?? 0) < n) fail(`${season} fell from ${n} to ${now[season] ?? 0} trades in this run; not uploading`);
  console.log('crawl guard: nothing shrank', JSON.stringify(now));
} else if (mode === 'merge') {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(arg).filter(x => /^\d{4}\.json\.gz$/.test(x))) {
    const file = path.join(OUT, f), add = read(path.join(arg, f)), doc = fs.existsSync(file) ? read(file) : { season: add.season, leagues: {}, trades: {} };
    const before = Object.keys(doc.trades).length;
    // What's already here wins: it's the newer read of any trade in both.
    doc.trades = { ...add.trades, ...doc.trades };
    doc.leagues = { ...add.leagues, ...doc.leagues };
    if (add.drafts || doc.drafts) doc.drafts = { ...(add.drafts || {}), ...(doc.drafts || {}) };
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(doc), { level: 9 }));
    console.log(`crawl guard: ${f.slice(0, 4)} ${before} -> ${Object.keys(doc.trades).length} trades`);
  }
} else fail('use check, mark, same or merge');
