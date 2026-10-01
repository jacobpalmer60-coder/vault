/* ============================================================
   SUMMARIZE SLEEPER TRADES
   Turns the raw Sleeper crawl (data/sleeper-trades/<season>.json.gz, from
   the "sleeper-trades" release; see crawl-sleeper-trades.js) into small
   files the Trade Database can chart, pricing every trade at KTC values
   from the day it happened:
     players: data/history/players-<format>.json (back to April 2020)
     picks:   data/pick-value-history.json (back to September 2023; a pick
              is priced as that year's mid pick in its round, or, for a year
              the history has no price for, the same round in the nearest year
              it does, as Vault.buildKtcPickMap does)
   Picks in rounds 5 and later, kickers and defenses carry ~no trade value
   (KTC doesn't price them), so they're left out of the value rather than
   dropping the trade. A trade with any other piece that has no price that
   day (e.g. a veteran KTC stopped tracking) is left out, so before
   September 2023 only player-for-player trades count.

   Each league's own settings pick its price format: Superflex or 1QB, and
   its TE premium (sf, sf_tep, sf_tepp, oneQB, ...), the same tiers the
   site uses (Vault.ktcTepSuffix).

   Writes data/market-history/<format>.json:
     { format, updated, leagues, trades: { crawled, priced },
       weeks: { 'YYYY-MM-DD' (the Monday): summary } }
   and data/market-history/<format>-players.json, by month, for players in
   at least 2 trades that month:
     { months: { 'YYYY-MM': { sleeperId: [trades, asMainPiece, medianPaid, oneForOne] } } }
   Summaries use lib-market.js, the same math as the KTC snapshot.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { loadVault, summarize, ROOT } = require('./lib-market');

const DATA = path.join(ROOT, 'data');
const IN = path.join(DATA, 'sleeper-trades');
const OUT = path.join(DATA, 'market-history');
const LOOKBACK = 14; // a missing day's price falls back to the last one within two weeks

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const tepSuffix = b => (b < 0.25 ? '' : b < 0.75 ? '_tep' : '_tepp'); // mirrors Vault.ktcTepSuffix
// Mirrors Vault.normalizeName: how KTC's name-keyed history matches Sleeper's players.
const normalizeName = s => !s ? '' : s.toString().toLowerCase().replace(/\./g, '').replace(/'/g, '')
  .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const monday = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

// Index of the last date <= d in a sorted list, or -1.
function dateIndex(dates, d) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

// players-<format>.json, decoded (same encoding as Vault.fetchPlayerValueHistory).
function playerPrices(format) {
  const slim = readJson(path.join(DATA, 'history', `players-${format}.json`));
  const byName = new Map(), dayMax = new Array(slim.dates.length).fill(0);
  for (const [name, enc] of Object.entries(slim.players)) {
    const vals = new Array(slim.dates.length).fill(null);
    let idx = enc[0], cur = enc[1];
    vals[idx] = cur;
    for (let k = 2; k < enc.length; k++) { idx++; if (enc[k] === null) continue; cur += enc[k]; vals[idx] = cur; }
    vals.forEach((v, i) => { if (v != null && v > dayMax[i]) dayMax[i] = v; });
    byName.set(name, vals);
  }
  const at = (name, d) => {
    const vals = byName.get(name), i = dateIndex(slim.dates, d);
    if (!vals || i < 0) return null;
    for (let k = i; k >= 0 && k > i - LOOKBACK; k--) if (vals[k] != null) return vals[k];
    return null;
  };
  return { at, maxAt: d => { const i = dateIndex(slim.dates, d); return i < 0 ? 0 : dayMax[i]; } };
}

function main() {
  const files = fs.existsSync(IN) ? fs.readdirSync(IN).filter(f => f.endsWith('.json.gz')) : [];
  if (!files.length) { console.log('No crawled Sleeper trades yet; nothing to summarize.'); return; }
  const Vault = loadVault();
  const sleeper = readJson(path.join(DATA, 'sleeper-players.json'));
  const pickSnaps = readJson(path.join(DATA, 'pick-value-history.json')).snapshots || [];
  const pickDates = pickSnaps.map(s => s.date);
  const pickAt = (season, round, format, d) => {
    const i = dateIndex(pickDates, d);
    if (i < 0) return null;
    for (let k = i; k >= 0 && k > i - LOOKBACK; k--) {
      const picks = pickSnaps[k].picks || {};
      const years = [...new Set(Object.keys(picks).map(key => +key.split('-')[0]))];
      if (!years.length) continue;
      const year = years.includes(+season) ? +season : years.reduce((b, y) => (Math.abs(y - season) < Math.abs(b - season) ? y : b), years[0]);
      const e = picks[`${year}-${round}-mid`];
      const v = e && (e[format] ?? e[format.replace(/_tepp?$/, '')]);
      if (v > 0) return v;
    }
    return null;
  };
  // Pieces with ~no trade value: left out of the value, not a reason to drop the trade.
  const negligible = id => (id[0] === 'p' ? +id.split('-')[1] >= 5 : ['K', 'DEF'].includes(sleeper[id]?.position));

  // Every crawled trade, grouped by its league's price format.
  const byFormat = new Map(), leagues = new Map();
  files.forEach(f => {
    const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IN, f))).toString('utf8'));
    Object.values(doc.trades).forEach(([date, lh, a, b]) => {
      const fmt = doc.leagues[lh];
      if (!fmt) return;
      const format = (fmt[0] === 2 ? 'sf' : 'oneQB') + tepSuffix(fmt[1]);
      (byFormat.get(format) || byFormat.set(format, []).get(format)).push({ date, a, b });
      (leagues.get(format) || leagues.set(format, new Set()).get(format)).add(lh);
    });
  });

  fs.mkdirSync(OUT, { recursive: true });
  byFormat.forEach((trades, format) => {
    const prices = playerPrices(format);
    const asset = (id, d) => {
      if (id[0] === 'p') {
        const [season, round] = id.slice(1).split('-');
        const value = pickAt(season, round, format, d);
        return value ? { type: 'pick', pos: null, value, id } : null;
      }
      const pl = sleeper[id];
      const value = pl && prices.at(normalizeName(`${pl.first_name || ''} ${pl.last_name || ''}`.trim()), d);
      return value ? { type: 'player', pos: pl.position, value, id } : null;
    };
    const weeks = new Map(), months = new Map();
    let priced = 0;
    trades.forEach(({ date, a, b }) => {
      const s1 = a.filter(id => !negligible(id)).map(id => asset(id, date)), s2 = b.filter(id => !negligible(id)).map(id => asset(id, date));
      if (!s1.length || !s2.length || s1.some(x => !x) || s2.some(x => !x)) return;
      priced++;
      const t = { s1, s2, date };
      (weeks.get(monday(date)) || weeks.set(monday(date), []).get(monday(date))).push(t);
      (months.get(date.slice(0, 7)) || months.set(date.slice(0, 7), []).get(date.slice(0, 7))).push(t);
    });
    // The consolidation math scales to the most valuable player at the time (see vault-core.js).
    const weekOut = {}, monthOut = {};
    [...weeks.keys()].sort().forEach(w => { Vault._globalMaxValue = prices.maxAt(w) || undefined; weekOut[w] = summarize(Vault, weeks.get(w), { players: false }); });
    [...months.keys()].sort().forEach(m => {
      Vault._globalMaxValue = prices.maxAt(`${m}-15`) || undefined;
      const s = summarize(Vault, months.get(m));
      monthOut[m] = Object.fromEntries(Object.entries(s.players).filter(([, v]) => v[0] >= 2));
    });
    fs.writeFileSync(path.join(OUT, `${format}.json`), JSON.stringify({ format, updated: new Date().toISOString(), leagues: leagues.get(format).size, trades: { crawled: trades.length, priced }, weeks: weekOut }));
    fs.writeFileSync(path.join(OUT, `${format}-players.json`), JSON.stringify({ format, months: monthOut }));
    console.log(`${format}: ${trades.length} trades from ${leagues.get(format).size} leagues, ${priced} priced, ${weeks.size} weeks`);
  });
}

main();
