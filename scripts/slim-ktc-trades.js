/* ============================================================
   SLIM KTC TRADES
   Runs in the daily Action right after fetch-ktc-trades.js. data/ktc-trades.json
   holds KTC's latest ~25,000 trades in every format (3.3 MB); every page only
   ever wants its own league's QB format, so this writes one compact file per
   format (Superflex ~650 KB, 1QB ~260 KB; about 150 KB and 60 KB downloaded):

     data/ktc-trades-<sf|oneQB>.json
       { updated, total, qbs, dates: ['YYYY-MM-DD', ...],
         trades: [[dateIdx, teams, ppr, tep, starters, [t1 ids], [t2 ids]], ...] }

   Ids that are KTC numbers are stored as numbers; anything else (KTC's
   "2027 Round 5" style labels) stays a string. Vault.fetchKtcTrades expands
   it back to the full file's trade shape. The full file is still written
   (snapshot-market.js reads every format from it).
   ============================================================ */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const full = JSON.parse(fs.readFileSync(path.join(DATA, 'ktc-trades.json'), 'utf8'));
const id = x => (/^\d+$/.test(x) ? +x : x);
[[2, 'sf'], [1, 'oneQB']].forEach(([qbs, name]) => {
  const trades = (full.trades || []).filter(t => t.qbs === qbs);
  const dates = [...new Set(trades.map(t => String(t.date).slice(0, 10)))].sort();
  const at = new Map(dates.map((d, i) => [d, i]));
  const out = { updated: full.updated, total: full.count, qbs, dates,
    trades: trades.map(t => [at.get(String(t.date).slice(0, 10)), t.teams, t.ppr, t.tep, t.starters, t.t1.map(id), t.t2.map(id)]) };
  const file = path.join(DATA, `ktc-trades-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`${name}: ${trades.length} trades, ${Math.round(fs.statSync(file).size / 1024)} KB`);
});
