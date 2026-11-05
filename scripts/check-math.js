#!/usr/bin/env node
/* Fixed trades with the answers the site gives today, so a change to the math shows exactly what
   moved, on purpose or not. The pieces are made up and held still: this tests the math, not the
   week's prices, so daily data can't turn it red. The market table stays off for the same reason.

     node scripts/check-math.js            compare with scripts/math-snapshot.json, fail on a change
     node scripts/check-math.js --update   accept the current answers as the new snapshot

   Update only after you've read what moved and meant it. */
const fs = require('fs');
const path = require('path');
const { loadVault } = require('./lib-market');

const FILE = path.join(__dirname, 'math-snapshot.json');
const Vault = loadVault();
const p = (value, pos = 'WR', age = 25) => ({ type: 'player', name: `${pos} ${value}`, value, pos, age });
const pick = (value, season = 2028, round = 1) => ({ type: 'pick', name: `${season} ${round}`, value, pos: 'PICK', season, round, age: 0 });

const TRADES = {
  'even 1 for 1': [[p(7000)], [p(7000)]],
  'small gap 1 for 1': [[p(7000)], [p(6500)]],
  'big gap 1 for 1': [[p(8000)], [p(5000)]],
  'star for two starters': [[p(9000)], [p(5000), p(4500)]],
  'star for a pile': [[p(9000, 'QB', 27)], [p(4000), p(3500), p(3000), p(2500)]],
  '2 for 1 close pieces': [[p(6000), p(5800)], [p(8500)]],
  'player for picks': [[p(6000, 'RB', 28)], [pick(3500), pick(3000, 2029)]],
  'picks only': [[pick(4000), pick(1500, 2028, 2)], [pick(5000)]],
  'old RB for young WR': [[p(5500, 'RB', 29)], [p(5500, 'WR', 23)]],
  'TE for QB': [[p(4500, 'TE', 26)], [p(4800, 'QB', 30)]],
  'four for three': [[p(5000), p(4000), p(3000), p(2000)], [p(6000), p(5000), p(3000)]],
};
const round = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

function snapshot() {
  const out = { trades: {}, verdicts: {}, buckets: {} };
  for (const [name, [a, b]] of Object.entries(TRADES)) {
    const s = Vault.tradeSideValues(a, b, { market: false });
    out.trades[name] = { valueA: round(s.valueA), valueB: round(s.valueB), bucket: Vault.fairnessBucket(Math.abs(200 * (s.valueA - s.valueB) / (s.valueA + s.valueB)), 0, 0), verdictPctA: round(Vault.verdictValuePct(b, a)), tiltContend: round(Vault.verdictValueTilt(b, a, 'contend')), tiltRebuild: round(Vault.verdictValueTilt(b, a, 'rebuild')) };
  }
  for (const mode of ['contend', 'flexible', 'rebuild']) {
    for (const [valuePct, ptsPerWeek] of [[-30, -2], [-12, 0], [-4, 1], [0, 0], [4, -1], [12, 0], [12, 2], [30, 3]]) {
      const v = Vault.tradeImprovement({ valuePct, rosterFit: 0, timelineFit: 0, mode, ptsPerWeek });
      out.verdicts[`${mode} value ${valuePct} points ${ptsPerWeek}`] = { score: round(v.score), tier: v.tier };
    }
  }
  for (const pct of [0, 4.9, 5, 9.9, 10, 14.9, 15, 19.9, 20, 29.9, 30, 50]) out.buckets[pct] = Vault.priceWord(Vault.fairnessBucket(pct, 0, 0));
  return out;
}

const now = snapshot();
if (process.argv.includes('--update')) {
  fs.writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
  console.log(`Saved ${Object.keys(now.trades).length} trades and ${Object.keys(now.verdicts).length} verdicts to scripts/math-snapshot.json`);
  process.exit(0);
}
const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const moved = [];
for (const part of Object.keys(now)) {
  for (const key of new Set([...Object.keys(now[part]), ...Object.keys(saved[part] || {})])) {
    const a = JSON.stringify(saved[part]?.[key]), b = JSON.stringify(now[part][key]);
    if (a !== b) moved.push(`${part} / ${key}\n  was ${a}\n  now ${b}`);
  }
}
if (moved.length) {
  console.error(`The math moved in ${moved.length} place${moved.length === 1 ? '' : 's'}:\n${moved.join('\n')}\nIf that's what you meant, run: node scripts/check-math.js --update`);
  process.exit(1);
}
console.log('Math unchanged');
