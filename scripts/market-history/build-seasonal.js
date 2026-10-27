/* When each kind of player is cheapest and dearest in the year, for the Player Market's
   timing line (2026-10-27, user picked "Best time to buy or sell"; rebuilt weekly by
   .github/workflows/market-history.yml, first built in the private VaultValues project).
   From KTC's daily history (data/history/players-<format>.json, Superflex and 1QB): every
   QB/RB/WR/TE worth MIN_VALUE+ at the start of a month, its change in log value to the
   next month's 1st, grouped by position, age band at the time and calendar month. Each
   group's average monthly change, less its average over the year (players drift down as
   they age and new rookies arrive: that isn't seasonal), added up through the year and
   centered: "% above or below this group's own yearly average" at the start of each month.
   Picks the same by round (data/pick-value-history.json, Oct 2023 on): the nearest class
   KTC lists, followed to the next month.
   node scripts/market-history/build-seasonal.js -> data/market-history/seasonal.json */
const fs = require('fs');
const path = require('path');
const { DATA, readSleeperPlayers, ktcPrices } = require('./ktc-book');
const players = readSleeperPlayers();
const MIN_VALUE = 1500, NOW = Date.now();
const AGES = [['young', a => a < 24], ['prime', a => a < 27], ['vet', a => a < 30], ['old', () => true]];
const ids = Object.keys(players).filter(id => ['QB', 'RB', 'WR', 'TE'].includes(players[id].position) && players[id].age);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
// Monthly changes -> an index through the year (start of each month vs the yearly average).
const curve = (g, min) => {
  if (g.some(a => a.length < min)) return null;
  const avg = g.map(mean), drift = mean(avg);
  const idx = [0]; for (let i = 0; i < 11; i++) idx.push(idx[i] + avg[i] - drift);
  const c = mean(idx);
  return { pct: idx.map(x => +(100 * (Math.exp(x - c) - 1)).toFixed(1)), n: g.reduce((s, a) => s + a.length, 0) };
};
const snaps = JSON.parse(fs.readFileSync(path.join(DATA, 'pick-value-history.json'), 'utf8')).snapshots || [];
const snapAt = d => { let s = null; for (const x of snaps) { if (x.date <= d) s = x; else break; } return s; };
const out = { updated: new Date().toISOString().slice(0, 10), formats: {} };
for (const format of ['sf', 'oneQB']) {
  const b = ktcPrices(format, players);
  const months = []; for (let y = 2020, m = 5; `${y}-${String(m).padStart(2, '0')}-01` <= b.latestDate; m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${String(m).padStart(2, '0')}-01`);
  const G = new Map(); // pos|age (and pos|all) -> month (0-11) -> [changes]
  const add = (k, mi, d) => { const g = G.get(k) || G.set(k, Array.from({ length: 12 }, () => [])).get(k); g[mi].push(d); };
  for (const id of ids) {
    const p = players[id];
    for (let i = 0; i + 1 < months.length; i++) {
      const v0 = b.at(id, months[i]), v1 = b.at(id, months[i + 1]);
      if (!(v0 >= MIN_VALUE) || !(v1 > 0)) continue;
      const age = p.age - (NOW - Date.parse(months[i])) / 3.156e10, band = AGES.find(a => a[1](age))[0];
      const mi = +months[i].slice(5, 7) - 1, d = Math.log(v1 / v0);
      add(`${p.position}|${band}`, mi, d); add(`${p.position}|all`, mi, d);
    }
  }
  const F = {};
  for (const [k, g] of G) { const c = curve(g, 30); if (c) F[k] = c; }
  // KTC lists the classes after the next draft only: the nearest class it lists, followed to the next month.
  const nextClass = d => { const s = snapAt(d); const ys = s ? Object.keys(s.picks || {}).map(k => +k.split('-')[0]) : []; return ys.length ? Math.min(...ys) : null; };
  const pickAt = (d, round, y) => { const s = snapAt(d), e = s && (s.picks || {})[`${y}-${round}-mid`]; return e ? (e[format] ?? null) : null; };
  for (const round of [1, 2]) {
    const g = Array.from({ length: 12 }, () => []);
    for (let i = 0; i + 1 < months.length; i++) {
      if (months[i] < '2023-10-01') continue;
      const y = nextClass(months[i]), v0 = pickAt(months[i], round, y), v1 = pickAt(months[i + 1], round, y);
      if (v0 > 0 && v1 > 0) g[+months[i].slice(5, 7) - 1].push(Math.log(v1 / v0));
    }
    const c = curve(g, 2); if (c) F[`PICK|${round}`] = c;
  }
  out.formats[format] = F;
  console.log(format, Object.keys(F).length, 'groups');
}
const dest = path.join(DATA, 'market-history', 'seasonal.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest}: ${(fs.statSync(dest).size / 1024).toFixed(1)} KB`);
