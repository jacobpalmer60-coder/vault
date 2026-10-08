/* KTC's price for a piece on a given day, from the site's own daily history
   (read-only: DynastyTool/data/history and pick-value-history.json), and
   KTC's consolidation-adjusted side values (the site's vault-core.js, loaded
   the same way its scripts do). Only used to compare against. */
const fs = require('fs');
const path = require('path');
const { SITE, SITE_DATA } = require('./load');

const LOOKBACK = 14; // a missing day falls back to the last price within two weeks
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const normalizeName = s => !s ? '' : s.toString().toLowerCase().replace(/\./g, '').replace(/'/g, '')
  .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const dateIndex = (dates, d) => { let lo = 0, hi = dates.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; };

function ktcPrices(format, players) {
  const slim = readJson(path.join(SITE_DATA, 'history', `players-${format}.json`));
  const byName = new Map();
  for (const [name, enc] of Object.entries(slim.players)) {
    const vals = new Array(slim.dates.length).fill(null);
    let idx = enc[0], cur = enc[1];
    vals[idx] = cur;
    for (let k = 2; k < enc.length; k++) { idx++; if (enc[k] === null) continue; cur += enc[k]; vals[idx] = cur; }
    byName.set(name, vals);
  }
  const snaps = readJson(path.join(SITE_DATA, 'pick-value-history.json')).snapshots || [];
  const pickDates = snaps.map(s => s.date);
  // strict: a pick only by its own year (no nearest-year stand-in), for valuing
  // a pick at a later date (payoff.js).
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
  return { at, latestDate: slim.dates[slim.dates.length - 1], firstDate: slim.dates[0] };
}

function loadVault() {
  return require(path.join(SITE, 'scripts', 'lib-market.js')).loadVault();
}

module.exports = { ktcPrices, loadVault, normalizeName };
