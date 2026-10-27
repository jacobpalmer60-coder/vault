/* Each player's trade history for the Player Market lookup (2026-10-27, user picked
   "Player trade history"; rebuilt weekly by .github/workflows/market-history.yml, first
   built in the private VaultValues project). Every crawled Sleeper trade since 2024 (the
   season files in data/sleeper-trades/), priced at KTC on its own day in its own league's
   format: picks in rounds 5+ and K/DEF left out, a trade with any other unpriced piece
   skipped. Per player, only aggregates (no league, team or manager):
     m     by month: [YYYY-MM, trades he was in, trades he headlined (the best piece on
           the side that got him), median paid vs KTC in those (what that side sent over
           what it got, on trade value: Vault.tradeValueRatio), null under 3]
     buy   teams that got him as the headliner, a year on (trades with a year of prices
           since): [trades, % ahead on trade value then, median change in his own KTC
           value over the year]; only with 10+
   Keyed by normalized name, as the page looks players up. Players with MIN_TRADES+
   headlined trades.
   node --max-old-space-size=6144 scripts/market-history/build-player-history.js
     -> data/market-history/player-history.json */
const fs = require('fs');
const path = require('path');
const { DATA, normalizeName, formatOf, readSleeperPlayers, seasonFiles, readSeason, ktcPrices } = require('./ktc-book');
const { loadVault } = require('../lib-market');
const Vault = loadVault();
const MIN_TRADES = 10, YEAR = 365 * 864e5, FROM_SEASON = 2024;
const players = readSleeperPlayers();
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']), SKIP_POS = new Set(['K', 'DEF']);
const books = new Map(), book = f => books.get(f) || books.set(f, ktcPrices(f, players)).get(f);
const pct = R => 200 * (R - 1) / (R + 1);
const median = a => { const b = Float64Array.from(a).sort(); return b.length ? b[(b.length - 1) >> 1] : null; };
const H = new Map(); // Sleeper id -> { m: Map(ym -> { n, h, paid: [] }), buy: [] }
const rec = id => H.get(id) || H.set(id, { m: new Map(), buy: [] }).get(id);
let total = 0, priced = 0;
const seen = new Set();
const files = seasonFiles(FROM_SEASON);
if (!files.length) { console.error('No season files in data/sleeper-trades/ (gh release download sleeper-trades)'); process.exit(1); }
for (const f of files) {
  const doc = readSeason(f);
  for (const [id, t] of Object.entries(doc.trades)) {
    if (seen.has(id)) continue; seen.add(id); total++;
    const [date, lh, s1, s2] = t, fmt = doc.leagues[lh]; if (!fmt) continue;
    const b = book(formatOf(fmt));
    const side = s => {
      const out = [];
      for (const k of s) {
        if (k[0] === 'p') { if (+k.split('-')[1] >= 5) continue; }
        else { const p = players[k]; if (p && SKIP_POS.has(p.position)) continue; }
        const v = b.at(k, date); if (!(v > 0)) return null;
        out.push({ k, v });
      }
      return out.length ? out : null;
    };
    const A = side(s1), B = side(s2); if (!A || !B) continue;
    priced++;
    const ym = date.slice(0, 7), later = Date.parse(date) + YEAR <= Date.parse(b.latestDate) ? new Date(Date.parse(date) + YEAR).toISOString().slice(0, 10) : null;
    for (const [got, gave] of [[A, B], [B, A]]) {
      const top = got.reduce((x, y) => (y.v > x.v ? y : x));
      for (const a of got) {
        if (a.k[0] === 'p' || !SKILL.has(players[a.k]?.position)) continue;
        const r = rec(a.k), m = r.m.get(ym) || r.m.set(ym, { n: 0, h: 0, paid: [] }).get(ym);
        m.n++;
        if (a !== top) continue;
        m.h++;
        m.paid.push(pct(Vault.tradeValueRatio(gave.map(x => x.v), got.map(x => x.v))));
        if (later) {
          const L = l => l.map(x => b.later(x.k, later) || 0).filter(v => v > 0), lg = L(got), lv = L(gave);
          const self = b.at(a.k, later);
          if (lg.length && lv.length) r.buy.push([pct(Vault.tradeValueRatio(lg, lv)), self > 0 ? 100 * (self / a.v - 1) : null]);
        }
      }
    }
  }
  console.log(`${f}: ${total.toLocaleString()} trades, ${priced.toLocaleString()} priced, ${H.size.toLocaleString()} players`);
}
const out = { updated: new Date().toISOString().slice(0, 10), trades: priced, players: {} };
for (const [id, r] of H) {
  const heads = [...r.m.values()].reduce((s, m) => s + m.h, 0);
  if (heads < MIN_TRADES) continue;
  const p = players[id], key = normalizeName(`${p.first_name || ''} ${p.last_name || ''}`);
  if (!key || out.players[key]) continue;
  const months = [...r.m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, m]) => [ym, m.n, m.h, m.paid.length >= 3 ? Math.round(median(m.paid)) : null]);
  const self = r.buy.map(x => x[1]).filter(v => v != null);
  const buy = r.buy.length >= 10 ? [r.buy.length, Math.round(100 * r.buy.filter(x => x[0] > 0).length / r.buy.length), self.length ? Math.round(median(self)) : null] : null;
  out.players[key] = { pos: p.position, m: months, ...(buy ? { buy } : {}) };
}
const dest = path.join(DATA, 'market-history', 'player-history.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest}: ${Object.keys(out.players).length} players, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
