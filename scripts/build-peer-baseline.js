#!/usr/bin/env node
/* ============================================================
   What players at each KTC value usually go for (marketPeerGrids in
   market-data.js), worked out here once a day. It reads every trade under every
   player, about 3 seconds of frozen page on the first trade anyone builds, so
   pages load this small file instead and only fall back to the math if it's
   missing. Same code, same trades, same day's values.

     data/market-history/peer-baseline.json
       { updated, sf: { all, even }, oneQB: { all, even } }

   Runs in the daily Action after the trade data it reads.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadVault } = require('./lib-market');

const ROOT = path.join(__dirname, '..');
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

async function grids(qbs, label) {
  const Vault = loadVault();
  Vault.fetchKtcTrades = async () => readJson('ktc-trades.json');
  Vault.fetchKtcValues = async () => readJson('ktc-values.json');
  Vault.fetchGradeValues = async () => null;
  const sandbox = {
    Vault, console, Math, Date, JSON, Map, Set, WeakMap, Number, String, Array, Object, Promise,
    fetch: async url => {
      const file = path.join(ROOT, url);
      if (!/recent-/.test(url) || !fs.existsSync(file)) return { ok: false };
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'market-data.js'), 'utf8')}\n;this.api = { marketLoad, marketPeerGrids };`, sandbox);
  await sandbox.api.marketLoad({ roster_positions: qbs === 2 ? ['QB', 'SUPER_FLEX'] : ['QB'], settings: {} });
  const out = { all: sandbox.api.marketPeerGrids(false), even: sandbox.api.marketPeerGrids(true) };
  console.log(`Peer baseline ${label}: ${out.all.grids.ALL.filter(v => v != null).length} of 101 steps`);
  return out;
}

(async () => {
  const out = { updated: new Date().toISOString(), sf: await grids(2, 'sf'), oneQB: await grids(1, 'oneQB') };
  fs.writeFileSync(path.join(ROOT, 'data', 'market-history', 'peer-baseline.json'), JSON.stringify(out));
})().catch(e => console.warn(`Peer baseline not updated: ${e.message}`));
