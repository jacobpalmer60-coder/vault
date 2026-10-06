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
       weeks: { 'YYYY-MM-DD' (the Monday): summary },
       years: { 'YYYY': summary } }   (each year summarized whole, so its medians are exact)
   and data/market-history/<format>-players.json, by month, for players in
   at least 2 trades that month:
     { months: { 'YYYY-MM': { sleeperId: [trades, asMainPiece, medianPaid, oneForOne] } } }
   and data/market-history/recent-<sf|oneQB>.json, priced trades from the last
   RECENT_DAYS days (all TE-premium tiers of that QB format, each priced in its
   own league's format), newest first, for the pages to pool with KTC's feed
   (they use only the days before KTC's feed starts, so no trade counts twice).
   At most RECENT_MAX trades, spread evenly over those days (recentSpread): the
   crawl finds thousands a day, so keeping only the newest would shrink the
   window to about a week. Days KTC's feed covers get none, since the pages
   skip them anyway:
     { updated, names: { sleeperId: [name, pos] },
       trades: [[date, [[id, value], ...], [[id, value], ...], [rec, bonusRecTe, teams]]] }
   (picks: 'p<season>-<round>'; the last part is the league's PPR, TE premium
   and team count, so pages can match trades to their own league's settings)
   and data/market-history/daily-<sf|oneQB>.json, each player's (and pick's,
   keyed 'k:<season>-<round>') market points for the player card and the
   Player Market page, for the last DAILY_KEEP_DAYS days (older ones by month
   in monthly-<sf|oneQB>.json: { before, players: { key: [['YYYY-MM', pct, trades]] } }):
   every day he was the main piece in at least one completed trade, the median premium (or discount) managers paid over KTC that day and
   how many trades it's from. Premium = what the getter sent / what his side
   was worth, both consolidation-adjusted, minus 1, as a whole-number %:
     { from: 'YYYY-MM-DD', players: { normalizedName: [[daysSinceFrom, pct, trades], ...] } }
   and data/market-history/rookies-<sf|oneQB>.json, from the crawl's rookie
   drafts (crawl-sleeper-trades.js fetchRookieDrafts), per rookie class
   (the league season) with at least ROOKIE_MIN_DRAFTS drafts:
     { updated, seasons: { 'YYYY': { drafts,
         players: [[sleeperId, name, pos, drafts, median, earliest, latest]],
         buys: { '<round>-<early|mid|late>': [players, medianKtcValue, medianKtcPickValue] } } } }
   A draft position is in rounds from the first pick, (round - 1) +
   (slot - 1) / teams, so leagues of any size line up (0.25 = a quarter of
   the way through round 1, "1.04" in a 12-team league). Players taken in at
   least ROOKIE_MIN_PICKS drafts. "buys": the KTC value, on the draft's own
   day in its league's format, of the players taken at each round's early /
   mid / late third, as a median: what that pick actually bought. Next to it,
   what KTC said that pick slot was worth on the same day (its last value
   within PICK_TIER_LOOKBACK days; null for years KTC's pick history lacks).
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
const RECENT_DAYS = 45, RECENT_MAX = 30000;
const ROOKIE_MIN_DRAFTS = 5, ROOKIE_MIN_PICKS = 3, ROOKIE_SHOW = 96;
const PICK_TIER_LOOKBACK = 45; // days back to find KTC's value for a drafted pick slot
const DAILY_KEEP_DAYS = 400; // day-by-day market points kept; older ones by month (monthly-<sf|oneQB>.json)

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
  // KTC's value for one pick slot (season, round, early/mid/late) as of a day: the
  // last snapshot on or before it that still lists that exact pick, within
  // PICK_TIER_LOOKBACK days (KTC can drop a year's picks around its draft).
  // Exact year only, unlike pickAt: this is what KTC said that very pick was worth.
  const pickTierAt = (season, round, tier, format, d) => {
    const i = dateIndex(pickDates, d);
    for (let k = i; k >= 0; k--) {
      if ((new Date(d) - new Date(pickDates[k])) / 864e5 > PICK_TIER_LOOKBACK) break;
      const e = (pickSnaps[k].picks || {})[`${season}-${round}-${tier}`];
      const v = e && (e[format] ?? e[format.replace(/_tepp?$/, '')]);
      if (v > 0) return v;
    }
    return null;
  };
  // Pieces with ~no trade value: left out of the value, not a reason to drop the trade.
  const negligible = id => (id[0] === 'p' ? +id.split('-')[1] >= 5 : ['K', 'DEF'].includes(sleeper[id]?.position));

  // Every crawled trade, grouped by its league's price format.
  const byFormat = new Map(), leagues = new Map(), docs = [];
  files.forEach(f => {
    const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IN, f))).toString('utf8'));
    docs.push(doc);
    Object.values(doc.trades).forEach(([date, lh, a, b]) => {
      const fmt = doc.leagues[lh];
      if (!fmt) return;
      const format = (fmt[0] === 2 ? 'sf' : 'oneQB') + tepSuffix(fmt[1]);
      (byFormat.get(format) || byFormat.set(format, []).get(format)).push({ date, a, b, f: [fmt[2], fmt[1], fmt[3]] });
      (leagues.get(format) || leagues.set(format, new Set()).get(format)).add(lh);
    });
  });

  fs.mkdirSync(OUT, { recursive: true });
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
  const recent = { sf: [], oneQB: [] };
  const premiums = { sf: new Map(), oneQB: new Map() }; // name -> [[date, premium %]]
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
    const weeks = new Map(), months = new Map(), years = new Map();
    let priced = 0;
    trades.forEach(({ date, a, b, f }) => {
      const s1 = a.filter(id => !negligible(id)).map(id => asset(id, date)), s2 = b.filter(id => !negligible(id)).map(id => asset(id, date));
      if (!s1.length || !s2.length || s1.some(x => !x) || s2.some(x => !x)) return;
      priced++;
      const t = { s1, s2, date, f };
      (weeks.get(monday(date)) || weeks.set(monday(date), []).get(monday(date))).push(t);
      (months.get(date.slice(0, 7)) || months.set(date.slice(0, 7), []).get(date.slice(0, 7))).push(t);
      (years.get(date.slice(0, 4)) || years.set(date.slice(0, 4), []).get(date.slice(0, 4))).push(t);
      if (date >= recentFrom) recent[format.startsWith('sf') ? 'sf' : 'oneQB'].push(t);
      // Each side's main piece (its best player): what that side cost over what it was worth.
      Vault._globalMaxValue = prices.maxAt(date) || undefined;
      const { valueA: v1, valueB: v2 } = Vault.tradeSideValues(s1, s2);
      [[s1, v1, v2], [s2, v2, v1]].forEach(([side, got, gave]) => {
        const top = side.reduce((m, a) => (a.value > m.value ? a : m));
        if (!got) return;
        const pl = sleeper[top.id];
        const key = top.type === 'pick' ? `k:${top.id.slice(1)}` : normalizeName(`${pl.first_name || ''} ${pl.last_name || ''}`.trim());
        const list = premiums[format.startsWith('sf') ? 'sf' : 'oneQB'];
        (list.get(key) || list.set(key, []).get(key)).push([date, (gave / got - 1) * 100]);
      });
    });
    // The consolidation math scales to the most valuable player at the time (see vault-core.js).
    const weekOut = {}, monthOut = {}, yearOut = {};
    [...years.keys()].sort().forEach(y => { Vault._globalMaxValue = prices.maxAt(`${y}-07-01`) || undefined; yearOut[y] = summarize(Vault, years.get(y), { players: false }); });
    [...weeks.keys()].sort().forEach(w => { Vault._globalMaxValue = prices.maxAt(w) || undefined; weekOut[w] = summarize(Vault, weeks.get(w), { players: false }); });
    [...months.keys()].sort().forEach(m => {
      Vault._globalMaxValue = prices.maxAt(`${m}-15`) || undefined;
      const s = summarize(Vault, months.get(m));
      monthOut[m] = Object.fromEntries(Object.entries(s.players).filter(([, v]) => v[0] >= 2));
    });
    fs.writeFileSync(path.join(OUT, `${format}.json`), JSON.stringify({ format, updated: new Date().toISOString(), leagues: leagues.get(format).size, trades: { crawled: trades.length, priced }, weeks: weekOut, years: yearOut }));
    fs.writeFileSync(path.join(OUT, `${format}-players.json`), JSON.stringify({ format, months: monthOut }));
    console.log(`${format}: ${trades.length} trades from ${leagues.get(format).size} leagues, ${priced} priced, ${weeks.size} weeks`);
  });

  // Each player's market points. The last DAILY_KEEP_DAYS day by day (every day
  // with a trade, that day's median premium); everything older by month, in
  // its own small file, so the day-by-day file the pages load stays small as
  // the history grows (pages merge the two: market-data.js fetchMarketDaily).
  const dailyFrom = new Date(Date.now() - DAILY_KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const medianOf = ps => { const s = [...ps].sort((x, y) => x - y); return Math.round(s[Math.floor((s.length - 1) / 2)]); };
  Object.entries(premiums).forEach(([qb, byName]) => {
    const players = {}, months = {};
    byName.forEach((events, name) => {
      const byDay = new Map(), byMonth = new Map();
      events.forEach(([d, p]) => {
        if (d >= dailyFrom) (byDay.get(d) || byDay.set(d, []).get(d)).push(p);
        else (byMonth.get(d.slice(0, 7)) || byMonth.set(d.slice(0, 7), []).get(d.slice(0, 7))).push(p);
      });
      if (byDay.size) players[name] = [...byDay.keys()].sort().map(d => [Math.round((new Date(d) - new Date(dailyFrom)) / 864e5), medianOf(byDay.get(d)), byDay.get(d).length]);
      if (byMonth.size) months[name] = [...byMonth.keys()].sort().map(m => [m, medianOf(byMonth.get(m)), byMonth.get(m).length]);
    });
    fs.writeFileSync(path.join(OUT, `daily-${qb}.json`), JSON.stringify({ from: dailyFrom, players }));
    fs.writeFileSync(path.join(OUT, `monthly-${qb}.json`), JSON.stringify({ before: dailyFrom, players: months }));
    console.log(`daily-${qb}: market points for ${Object.keys(players).length} players since ${dailyFrom}, ${Object.keys(months).length} by month before`);
  });

  // Rookie drafts: where each rookie went, and what each pick slot bought.
  const priceCache = new Map(), pricesFor = f => priceCache.get(f) || priceCache.set(f, playerPrices(f)).get(f);
  const rookies = { sf: new Map(), oneQB: new Map() };
  const med = l => { const s = [...l].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
  docs.forEach(doc => Object.values(doc.drafts || {}).forEach(([date, lh, teams, picks]) => {
    const fmt = doc.leagues[lh];
    if (!fmt || !teams) return;
    const qb = fmt[0] === 2 ? 'sf' : 'oneQB', format = qb + tepSuffix(fmt[1]), season = String(doc.season);
    const S = rookies[qb].get(season) || rookies[qb].set(season, { drafts: 0, players: new Map(), buys: new Map(), ktc: new Map() }).get(season);
    S.drafts++;
    picks.forEach(([no, round, pid]) => {
      const slot = no - (round - 1) * teams;
      if (slot < 1 || slot > teams) return;
      (S.players.get(pid) || S.players.set(pid, []).get(pid)).push((round - 1) + (slot - 1) / teams);
      const pl = sleeper[pid], value = pl && pricesFor(format).at(normalizeName(`${pl.first_name || ''} ${pl.last_name || ''}`.trim()), date);
      const tier = slot <= teams / 3 ? 'early' : slot <= (2 * teams) / 3 ? 'mid' : 'late';
      if (value) (S.buys.get(`${round}-${tier}`) || S.buys.set(`${round}-${tier}`, []).get(`${round}-${tier}`)).push(value);
      const said = round <= 4 && pickTierAt(season, round, tier, format, date);
      if (said) (S.ktc.get(`${round}-${tier}`) || S.ktc.set(`${round}-${tier}`, []).get(`${round}-${tier}`)).push(said);
    });
  }));
  Object.entries(rookies).forEach(([qb, bySeason]) => {
    const seasons = {};
    bySeason.forEach((S, season) => {
      if (S.drafts < ROOKIE_MIN_DRAFTS) return;
      const players = [...S.players.entries()].filter(([, l]) => l.length >= ROOKIE_MIN_PICKS).map(([pid, l]) => {
        const pl = sleeper[pid] || {};
        return [pid, `${pl.first_name || ''} ${pl.last_name || ''}`.trim(), pl.position || '', l.length, +med(l).toFixed(3), +Math.min(...l).toFixed(3), +Math.max(...l).toFixed(3)];
      }).sort((a, b) => a[4] - b[4]).slice(0, ROOKIE_SHOW);
      const buys = {};
      S.buys.forEach((vals, k) => { const said = S.ktc.get(k); buys[k] = [vals.length, Math.round(med(vals)), said ? Math.round(med(said)) : null]; });
      seasons[season] = { drafts: S.drafts, players, buys };
    });
    fs.writeFileSync(path.join(OUT, `rookies-${qb}.json`), JSON.stringify({ updated: new Date().toISOString(), seasons }));
    console.log(`rookies-${qb}: ${Object.entries(seasons).map(([s, v]) => `${s} (${v.drafts} drafts)`).join(', ') || 'none yet'}`);
  });

  // Recent trades for the pages to pool with KTC's feed, with names for the players in them.
  Object.entries(recent).forEach(([qb, list]) => {
    const keep = recentSpread(list, ktcFeedFrom(qb)), names = {};
    const side = s => s.map(a => {
      if (a.type === 'player' && !names[a.id]) { const p = sleeper[a.id]; names[a.id] = [`${p.first_name || ''} ${p.last_name || ''}`.trim(), p.position]; }
      return [a.id, Math.round(a.value)];
    });
    fs.writeFileSync(path.join(OUT, `recent-${qb}.json`), JSON.stringify({ updated: new Date().toISOString(), names, trades: keep.map(t => [t.date, side(t.s1), side(t.s2), t.f]) }));
    const days = new Set(keep.map(t => t.date));
    console.log(`recent-${qb}: ${keep.length} of ${list.length} trades over ${days.size} days since ${recentFrom}`);
  });
}

// First day of KTC's own trade feed for this QB format (data/ktc-trades-<sf|oneQB>.json,
// refreshed nightly); the pages use Sleeper trades only from before it. null if missing.
function ktcFeedFrom(qb) {
  try {
    const d = readJson(path.join(DATA, `ktc-trades-${qb}.json`));
    const dates = (d.trades || []).map(t => String(d.dates ? d.dates[t[0]] : t.date).slice(0, 10)).filter(Boolean).sort();
    return dates[0] || null;
  } catch { return null; }
}

// Up to RECENT_MAX trades spread evenly across the days before `ktcFrom`: each day
// gets an equal share, and a quiet day's unused share passes to the busier ones.
// Within a day the pick is by a hash of the trade itself, not its position in the
// crawl, so the same trades stay chosen from run to run (the file changes little).
function recentSpread(list, ktcFrom) {
  const byDay = new Map();
  list.forEach(t => { if (!ktcFrom || t.date < ktcFrom) (byDay.get(t.date) || byDay.set(t.date, []).get(t.date)).push(t); });
  const hash = t => { let h = 2166136261; for (const c of JSON.stringify([t.date, t.s1.map(a => a.id), t.s2.map(a => a.id)])) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const days = [...byDay.keys()].sort((a, b) => byDay.get(a).length - byDay.get(b).length); // quietest first
  let budget = RECENT_MAX;
  const keep = [];
  days.forEach((d, i) => {
    const share = Math.floor(budget / (days.length - i));
    const day = byDay.get(d);
    const take = day.length <= share ? day : day.map(t => [hash(t), t]).sort((a, b) => a[0] - b[0]).slice(0, share).map(x => x[1]);
    keep.push(...take);
    budget -= take.length;
  });
  return keep.sort((x, y) => y.date.localeCompare(x.date));
}

main();
