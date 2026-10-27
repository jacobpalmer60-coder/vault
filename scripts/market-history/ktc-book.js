/* KTC's price for a piece on a given day, for the Player Market builders in this folder
   (2026-10-27, ported from the private VaultValues project's ktc.js so a GitHub Action can
   rebuild the files weekly). Reads the site's own data: data/history/players-<format>.json
   (slim daily KTC history), data/pick-value-history.json and data/sleeper-players.json,
   plus the crawl's season files in data/sleeper-trades/ (the "sleeper-trades" release) for
   rookie drafts. Players are Sleeper ids; picks 'p<season>-<round>'. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA, 'sleeper-trades');
const LOOKBACK = 14; // a missing day falls back to the last price within two weeks
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const normalizeName = s => !s ? '' : s.toString().toLowerCase().replace(/\./g, '').replace(/'/g, '')
  .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const dateIndex = (dates, d) => { let lo = 0, hi = dates.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; };
const tep = t => (t < 0.25 ? '' : t < 0.75 ? '_tep' : '_tepp');
// A league's format from the crawl's [qbs, tep, ...] tuple.
const formatOf = f => (f[0] === 2 ? 'sf' : 'oneQB') + tep(f[1]);
const readSleeperPlayers = () => readJson(path.join(DATA, 'sleeper-players.json'));
const seasonFiles = (from = 0) => (fs.existsSync(RAW_DIR) ? fs.readdirSync(RAW_DIR).filter(f => /^\d{4}\.json\.gz$/.test(f) && +f.slice(0, 4) >= from).sort() : []);
const readSeason = f => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW_DIR, f))));

// Completed rookie drafts for one format and season: the Sleeper ids taken in each round (5+ together).
const draftsMemo = new Map();
function loadDrafts(format, season) {
  const k = `${format}|${season}`; if (draftsMemo.has(k)) return draftsMemo.get(k);
  const f = path.join(RAW_DIR, `${season}.json.gz`), out = new Map();
  let drafts = 0;
  if (fs.existsSync(f)) {
    const doc = readSeason(`${season}.json.gz`);
    for (const [date, lh, , list] of Object.values(doc.drafts || {})) {
      if (date < `${season}-03-01` || date > `${season}-08-31`) continue;
      const lf = doc.leagues[lh]; if (!lf || formatOf(lf) !== format) continue;
      drafts++;
      for (const [, round, sid] of list) { if (!sid) continue; const r = Math.min(5, round); (out.get(r) || out.set(r, []).get(r)).push(String(sid)); }
    }
  }
  const res = { rounds: out, drafts }; draftsMemo.set(k, res); return res;
}

function ktcPrices(format, players) {
  const slim = readJson(path.join(DATA, 'history', `players-${format}.json`));
  const byName = new Map();
  for (const [name, enc] of Object.entries(slim.players)) {
    const vals = new Array(slim.dates.length).fill(null);
    let idx = enc[0], cur = enc[1];
    vals[idx] = cur;
    for (let k = 2; k < enc.length; k++) { idx++; if (enc[k] === null) continue; cur += enc[k]; vals[idx] = cur; }
    byName.set(name, vals);
  }
  const snaps = readJson(path.join(DATA, 'pick-value-history.json')).snapshots || [];
  const pickDates = snaps.map(s => s.date);
  // strict: a pick only by its own year (no nearest-year stand-in), for valuing it at a later date.
  const at = (key, d, strict = false) => {
    if (key[0] === 'p') {
      const [season, round] = key.slice(1).split('-').map(Number);
      const i = dateIndex(pickDates, d);
      for (let k = i; k >= 0 && k > i - LOOKBACK; k--) {
        const picks = snaps[k].picks || {};
        const years = [...new Set(Object.keys(picks).map(x => +x.split('-')[0]))];
        if (!years.length) continue;
        if (strict && !years.includes(season)) continue;
        const year = years.includes(season) ? season : years.reduce((b, y) => (Math.abs(y - season) < Math.abs(b - season) ? y : b), years[0]);
        const e = picks[`${year}-${round}-mid`];
        const v = e && (e[format] ?? e[format.replace(/_tepp?$/, '')]);
        if (v > 0) return v;
      }
      return null;
    }
    const p = players[key];
    const vals = p && byName.get(normalizeName(`${p.first_name || ''} ${p.last_name || ''}`));
    const i = dateIndex(slim.dates, d);
    if (!vals || i < 0) return null;
    for (let k = i; k >= 0 && k > i - LOOKBACK; k--) if (vals[k] != null) return vals[k];
    return null;
  };
  // A pick whose draft has happened became a player: the average KTC value on d of the
  // rookies taken in that round of that season's real rookie drafts in this format.
  const became = new Map();
  const later = (key, d) => {
    const v = at(key, d, true);
    if (v != null || key[0] !== 'p') return v;
    const [season, round] = key.slice(1).split('-').map(Number);
    const ck = `${season}-${Math.min(5, round)}-${d}`;
    if (!became.has(ck)) {
      const ids = loadDrafts(format, season).rounds.get(Math.min(5, round)) || [];
      became.set(ck, ids.length >= 20 ? ids.reduce((s, id) => s + (at(id, d) || 0), 0) / ids.length : null);
    }
    return became.get(ck);
  };
  return { at, later, latestDate: slim.dates[slim.dates.length - 1], firstDate: slim.dates[0] };
}

module.exports = { ROOT, DATA, RAW_DIR, normalizeName, formatOf, readSleeperPlayers, seasonFiles, readSeason, ktcPrices };
