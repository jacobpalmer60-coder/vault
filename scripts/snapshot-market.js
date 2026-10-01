/* ============================================================
   SNAPSHOT MARKET
   Runs in the daily Action right after fetch-ktc.js and fetch-ktc-trades.js.
   data/ktc-trades.json only ever holds KTC's latest ~25,000 trades (about
   4-5 days), so this keeps a small daily SUMMARY of each day's real trades
   before they roll off. Raw trades would be ~0.6 MB a day; a summary is a few
   KB per format.

   Writes data/market/<format>-<YYYY-MM>.json, format = 'sf' or 'oneQB' (KTC's
   QB setting; every PPR/TE setting pooled), one entry per day:
     { days: { 'YYYY-MM-DD': {
         n,                 priced trades that day (every piece has a KTC price)
         pct: [17 counts],  % off on KTC value in 5%-wide bins, the last 80%+
         buckets: [fair, lopsided, unfair],
         shapes: { '1-for-2': [n, medianPctOff, medianPaid|null] },
         stars:  { '8000': [n, oneForOne] },   best piece 8,000+, 6,000+, ...
         pos:    { QB: [n, oneForOne, medianPctOff, medianPaid|null] },
         players: { ktcId: [trades, asMainPiece, medianPaid|null, oneForOne] }
       } } }
   "Paid" is from the side getting fewer pieces (shapes, pos) or the side
   getting the player as the main piece (players): what they sent minus what
   they got, as a % of the two sides' average. All of it uses the site's own
   math (Vault.tradeSideValues, Vault.fairnessBucket from vault-core.js, run
   in a sandbox by lib-market.js, shared with summarize-sleeper-trades.js), priced at that run's KTC values in plain sf/oneQB.

   Each run re-summarizes every day in the current window and keeps whichever
   version of a day saw more trades: the window's first and last days are
   partial, and the next run fills the last one in.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { loadVault, summarize, ROOT } = require('./lib-market');

const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'market');

function main() {
  const Vault = loadVault();
  const ktc = JSON.parse(fs.readFileSync(path.join(DATA, 'ktc-values.json'), 'utf8'));
  const db = JSON.parse(fs.readFileSync(path.join(DATA, 'ktc-trades.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const formats = [['sf', 2], ['oneQB', 1]];
  // The consolidation math scales to today's single most valuable player (see vault-core.js).
  let written = 0;
  formats.forEach(([field, qbs]) => {
    Vault._globalMaxValue = Math.max(...(ktc.players || []).map(p => p[field] || 0));
    const price = new Map();
    (ktc.players || []).forEach(p => { if (p.ktcId != null && p[field] > 0) price.set(String(p.ktcId), { type: 'player', pos: p.pos, value: p[field] }); });
    (ktc.picks || []).forEach(p => { if (p.ktcId != null && p[field] > 0) price.set(String(p.ktcId), { type: 'pick', pos: null, value: p[field] }); });
    const byDay = new Map();
    (db.trades || []).filter(t => t.qbs === qbs && t.t1.length && t.t2.length).forEach(t => {
      const d = String(t.date).slice(0, 10);
      (byDay.get(d) || byDay.set(d, []).get(d)).push(t);
    });
    byDay.forEach((trades, d) => {
      const file = path.join(OUT, `${field}-${d.slice(0, 7)}.json`);
      const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { format: field, days: {} };
      // Only trades where every piece has a KTC price.
      const priced = trades.map(t => ({ s1: t.t1.map(id => price.get(id) && { ...price.get(id), id }), s2: t.t2.map(id => price.get(id) && { ...price.get(id), id }) }))
        .filter(t => t.s1.every(Boolean) && t.s2.every(Boolean));
      const summary = summarize(Vault, priced);
      if (doc.days[d] && doc.days[d].n >= summary.n) return; // an earlier run saw more of this day
      doc.days[d] = summary;
      doc.days = Object.fromEntries(Object.entries(doc.days).sort(([a], [b]) => a.localeCompare(b)));
      fs.writeFileSync(file, JSON.stringify(doc));
      written++;
      console.log(`${field} ${d}: ${summary.n} priced trades`);
    });
  });
  console.log(`Market snapshot: ${written} day summaries written`);
}

main();
