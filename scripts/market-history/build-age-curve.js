/* How much of a player's KTC value is left one, two and three years on, by position and age
   (2026-11-05), for the Trade Calculator's look at the next three seasons.

   Two reads that fail in opposite directions, averaged (geometric mean):
   - Followed over time: KTC's daily history, value-weighted, from the start of each month since
     2020. It only covers players still ranked today, so everyone who washed out is missing and it
     runs too kind (a 30-year-old RB came out gaining value).
   - Today's market: total KTC value at each age against the total a few years older. Everyone's in
     it, but draft classes differ in size and ages thin out fast, so it runs harsh and bumpy.
   Then smoothed so it never rises with age or with time. Under 24 holds at 1 in the market read:
   those ages are still filling up with new rookies, which isn't growth. It's a rough shape for
   comparing rosters, not a price forecast. Moves slowly, so it's run by hand about once a year:
   node scripts/market-history/build-age-curve.js -> data/market-history/age-curve.json */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const LO = 21, HI = 36, POS = ['QB', 'RB', 'WR', 'TE'], HOLD_UNDER = 24, MIN_VALUE = 1000, YEAR = 365.25 * 864e5;
const norm = s => String(s).toLowerCase().replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ktc = read('ktc-values.json');

// Followed over time: { pos: { age: [1y, 2y, 3y] } }.
function followed(format, ageOf) {
  const doc = read(`history/players-${format}.json`), dates = doc.dates, firsts = dates.map((d, i) => (d.endsWith('-01') ? i : -1)).filter(i => i >= 0);
  const sum = {}; POS.forEach(p => { sum[p] = {}; for (let a = LO; a <= HI; a++) sum[p][a] = { base: [0, 0, 0], later: [0, 0, 0] }; });
  for (const [name, row] of Object.entries(doc.players)) {
    const p = ageOf.get(norm(name));
    if (!p) continue;
    const [start, first, ...deltas] = row, values = [first];
    deltas.forEach(d => values.push(values[values.length - 1] + d));
    const at = i => (i < start || i >= start + values.length ? 0 : values[i - start]);
    for (const i of firsts) {
      const v0 = at(i);
      if (!(v0 >= MIN_VALUE)) continue;
      const a = Math.max(LO, Math.min(HI, Math.round(p.age - (Date.now() - Date.parse(dates[i])) / YEAR)));
      for (let y = 1; y <= 3; y++) {
        const j = dates.indexOf(`${+dates[i].slice(0, 4) + y}${dates[i].slice(4)}`);
        if (j < 0) continue;
        sum[p.pos][a].base[y - 1] += v0;
        sum[p.pos][a].later[y - 1] += at(j);
      }
    }
  }
  const out = {};
  POS.forEach(pos => {
    out[pos] = {};
    for (let a = LO; a <= HI; a++) {
      const near = [a - 2, a - 1, a, a + 1, a + 2].filter(x => sum[pos][x]);
      out[pos][a] = [0, 1, 2].map(k => { const base = near.reduce((s, x) => s + sum[pos][x].base[k], 0); return base ? near.reduce((s, x) => s + sum[pos][x].later[k], 0) / base : null; });
    }
  });
  return out;
}
// Today's market: { pos: { age: [1y, 2y, 3y] } }.
function market(format) {
  const out = {};
  POS.forEach(pos => {
    const raw = {};
    for (let a = LO; a <= HI + 5; a++) raw[a] = 0;
    ktc.players.filter(p => p.pos === pos && p.age > 0 && p[format] > 0).forEach(p => { const a = Math.max(LO, Math.round(p.age)); if (a in raw) raw[a] += p[format]; });
    const smooth = a => { const near = [a - 2, a - 1, a, a + 1, a + 2].filter(x => x in raw); return near.reduce((s, x) => s + raw[x], 0) / near.length; };
    out[pos] = {};
    for (let a = LO; a <= HI; a++) {
      const base = smooth(Math.max(a, HOLD_UNDER));
      out[pos][a] = [1, 2, 3].map(y => (a + y <= HOLD_UNDER ? 1 : base ? Math.min(1, smooth(a + y) / base) : null));
    }
  });
  return out;
}

const ages = new Map();
ktc.players.forEach(p => { if (POS.includes(p.pos) && p.age > 0) ages.set(norm(p.name), { pos: p.pos, age: p.age }); });
const out = { updated: new Date().toISOString().slice(0, 10) };
for (const format of ['sf', 'oneQB']) {
  const f = followed(format, ages), m = market(format);
  out[format] = {};
  for (const pos of POS) {
    const curve = {};
    for (let a = LO; a <= HI; a++) curve[a] = [0, 1, 2].map(k => { const x = f[pos][a][k], y = m[pos][a][k]; return x > 0 && y > 0 ? Math.sqrt(Math.min(1, x) * y) : y ?? x ?? 0; });
    // Older never keeps more, and later never keeps more.
    for (let a = LO + 1; a <= HI; a++) curve[a] = curve[a].map((v, k) => Math.min(v, curve[a - 1][k]));
    for (let a = LO; a <= HI; a++) { for (let k = 1; k < 3; k++) curve[a][k] = Math.min(curve[a][k], curve[a][k - 1]); curve[a] = curve[a].map(v => +v.toFixed(3)); }
    out[format][pos] = curve;
    console.log(format, pos, [23, 25, 27, 29, 31].map(a => `${a}: ${curve[a].join(' ')}`).join('  |  '));
  }
}
fs.writeFileSync(path.join(ROOT, 'data', 'market-history', 'age-curve.json'), JSON.stringify(out));
