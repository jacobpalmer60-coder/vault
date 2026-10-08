/* Vault values (our own player and pick values, learned from real trades).
   Production copy of the VaultValues research project's src/load.js, run by
   .github/workflows/vault-values.yml; research and tests stay in VaultValues.

   Load completed trades for one league format from the crawl's season files
   (data/sleeper-trades/<season>.json.gz, the "sleeper-trades" release the
   workflow downloads) into flat arrays the model can loop over fast.

   Each trade: the week it happened, and the pieces each side received.
   Assets are players (Sleeper id) and picks by year and round ('p2027-1').
   Rounds 5+ carry almost no value, so they're dropped from a side; trades
   with anything else we don't model (kickers, defenses, IDP, players too
   rarely traded to rate) are dropped whole. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..'); // the site's repo
const SITE = ROOT;
const SITE_DATA = path.join(ROOT, 'data');
const RAW = path.join(ROOT, 'data', 'sleeper-trades');
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const MAX_PIECES = 6; // bigger sides are usually dispersal or roster dumps

const tepSuffix = b => (b < 0.25 ? '' : b < 0.75 ? '_tep' : '_tepp');
const formatOf = f => (f[0] === 2 ? 'sf' : 'oneQB') + tepSuffix(f[1]);
const DAY = 864e5;
const BASE = Date.UTC(2024, 11, 2); // a Monday; week 0
const weekOf = d => Math.floor((Date.parse(d + 'T00:00:00Z') - BASE) / (7 * DAY));
const weekStart = w => new Date(BASE + w * 7 * DAY).toISOString().slice(0, 10);

function readSleeperPlayers() {
  return JSON.parse(fs.readFileSync(path.join(SITE_DATA, 'sleeper-players.json'), 'utf8'));
}

/* { trades: [{ date, week, a: [assetKey], b: [assetKey] }], players } for one format. */
function loadTrades(format, seasons = [2025, 2026]) {
  const players = readSleeperPlayers();
  const trades = [];
  const seen = new Set();
  for (const season of seasons) {
    const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, `${season}.json.gz`))));
    for (const [id, t] of Object.entries(doc.trades)) {
      if (seen.has(id)) continue; // a trade can sit in two season files
      seen.add(id);
      const [date, lh, s1, s2] = t;
      const f = doc.leagues[lh];
      if (!f || formatOf(f) !== format) continue;
      const side = s => {
        const out = [];
        for (const k of s) {
          if (k[0] === 'p') { const round = +k.split('-')[1]; if (round <= 4) out.push(k); continue; }
          const p = players[k];
          if (!p || !POSITIONS.has(p.position)) return null; // K, DEF, IDP: not modeled
          out.push(k);
        }
        return out;
      };
      const a = side(s1), b = side(s2);
      if (!a || !b || !a.length || !b.length || a.length > MAX_PIECES || b.length > MAX_PIECES) continue;
      trades.push({ date, week: weekOf(date), a, b });
    }
  }
  trades.sort((x, y) => (x.date < y.date ? -1 : 1));
  return { trades, players };
}

module.exports = { loadTrades, readSleeperPlayers, weekOf, weekStart, SITE, SITE_DATA, ROOT, RAW, formatOf };
