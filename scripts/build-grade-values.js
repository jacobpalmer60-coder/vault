/* What each player and pick actually trades for, for the grade (2026-10-09; user
   chose "blend toward market", after testing RosterAudit's idea of values learned
   from real trades): data/grade-values.json, built daily after the trade data
   updates. The grade's value for a piece = KTC value x (1 + its premium / 100).

   The premium is the site's own market read (market-data.js, run here in a
   sandbox on the same files the pages load: KTC's trade database for its last
   few days, then completed Sleeper trades back to 45 days): the median, over
   completed trades the piece headlined (the best piece on its side), of what the
   team getting it sent over what its side was worth, on trade value with KTC
   values (no market prices: those are what's being measured). At least
   MARKET_MIN_COMPS trades, no cap (MARKET_ADJ_CAP is Infinity). Per league format: QB
   format (one file each) and TE premium (trades from leagues with the same TE
   premium when there are MARKET_MIN_NARROW of them, else every trade in the QB
   format). Players keyed 'n:' + normalized name, picks 'k:<season>-<round>'.

   Tested on 275,273 Sleeper trades from June to October 2026, prices rebuilt
   weekly from the 45 days before (VaultValues market-blend-test.js): the full
   market price called 77.2% Fair against 75.0% on KTC values (1-for-1s 57.0%
   against 53.9%); 60% of it, 76.7%. node scripts/build-grade-values.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sandbox = {
  console, Math, Date, JSON, Map, Set, WeakMap, Number, String, Array, Object, Promise, setTimeout, clearTimeout,
  window: {}, location: { search: '', pathname: '/', href: '' },
  document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
  MutationObserver: class { observe() {} }, HTMLSelectElement: function () {}, navigator: {},
  // The pages' fetches, from the local data files.
  fetch: async url => { const f = String(url).split('?')[0]; if (!fs.existsSync(path.join(ROOT, f))) return { ok: false, status: 404 }; const body = read(f); return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body }; }
};
vm.createContext(sandbox);
vm.runInContext(read('vault-core.js') + '\n;this.Vault = Vault; this.VAULT_CONFIG = VAULT_CONFIG;', sandbox);
vm.runInContext(read('market-data.js') + '\n;this.Market = Market; this.marketLoad = marketLoad; this.marketComps = marketComps; this.marketPremium = marketPremium;', sandbox);
const { Vault } = sandbox;
const MIN = vm.runInContext('MARKET_MIN_COMPS', sandbox), NARROW = vm.runInContext('MARKET_MIN_NARROW', sandbox), CAP = vm.runInContext('MARKET_ADJ_CAP', sandbox);
const median = l => { const s = [...l].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

(async () => {
  const out = { updated: new Date().toISOString(), formats: {} };
  for (const qbs of [2, 1]) {
    // A stand-in league for the QB format (the market data is loaded per QB format).
    sandbox.Market.data = null; sandbox.Market.loading = null;
    const league = { roster_positions: qbs === 2 ? ['QB', 'SUPER_FLEX'] : ['QB'], total_rosters: 12, scoring_settings: { rec: 1 } };
    const data = await sandbox.marketLoad(league);
    if (!data || data.failed) throw new Error('market data failed to load for qbs ' + qbs);
    const base = qbs === 2 ? 'sf' : 'oneQB';
    for (const [suffix, tep] of [['', 0], ['_tep', 1], ['_tepp', 2]]) {
      const prem = {};
      for (const key of data.byPlayer.keys()) {
        const main = sandbox.marketComps(key).filter(c => c.main);
        const same = main.filter(c => (c.t.fmt?.tep ?? 0) === tep);
        const pool = same.length >= NARROW ? same : main;
        if (pool.length < MIN) continue;
        const p = Math.max(-CAP, Math.min(CAP, median(pool.map(sandbox.marketPremium))));
        if (Math.abs(p) >= 0.5) prem[key] = Math.round(p * 10) / 10;
      }
      out.formats[base + suffix] = prem;
      console.log(`${base + suffix}: ${Object.keys(prem).length} players and picks priced off KTC (${data.byPlayer.size} traded in ${data.days} days)`);
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'grade-values.json'), JSON.stringify(out));
  // The history past trades are graded with (data/grade-values-history/, built
  // back to 2023 by VaultValues grade-history.js): on the first run on or after
  // the 1st and the 16th, today's prices become that date's snapshot.
  const today = new Date().toISOString().slice(0, 10), snap = `${today.slice(0, 8)}${+today.slice(8) >= 16 ? '16' : '01'}`;
  for (const [key, table] of Object.entries(out.formats)) {
    const file = path.join(ROOT, 'data', 'grade-values-history', `${key}.json`);
    if (!fs.existsSync(file)) continue;
    const h = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (h.dates[h.dates.length - 1] >= snap) continue;
    h.dates.push(snap);
    h.tables.push(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v)));
    fs.writeFileSync(file, JSON.stringify(h));
    console.log(`${key}: history snapshot ${snap} added`);
  }
})().catch(e => { console.error(e); process.exit(1); });
