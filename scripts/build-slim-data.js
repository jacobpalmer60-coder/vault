/* ============================================================
   BUILD SLIM DATA
   Runs in the daily Action after snapshot-value-history.js. Writes small,
   page-ready versions of two big downloads so pages stop fetching ~9 MB
   (compressed) before they can render:

   1. data/history/players-<field>.json — data/player-value-history.json
      (33 MB, every player in six price formats) split into one file per
      format (sf, oneQB, sf_tep, sf_tepp, oneQB_tep, oneQB_tepp), since a
      league only ever uses one. Stored column-wise and delta-encoded:
        { dates: [...], players: { name: [startIdx, firstValue, d1, d2, ...] } }
      where each dN is the change from the previous day and null marks a day
      the player wasn't in that snapshot. A TEP format falls back to the plain
      price on days KTC had no separate TEP number (same fallback as
      Vault.resolveHistoricalValue). Decoded by Vault.fetchPlayerValueHistory.

   2. data/history/player-stats.json — the projected stats some snapshots
      carry, kept separately since only Player Rankings reads them:
        { dates: [...], players: { name: { dateIdx: stats } } }

   3. data/sleeper-players.json — Sleeper's /players/nfl (~15 MB) cut to the
      fields the site reads: first_name, last_name, position, age, team,
      years_exp. Every player is kept (old trades and IDP rosters still need
      names). Also keeps the site to one players/nfl call a day, which is
      what Sleeper asks of API users.
   ============================================================ */
const fs = require('fs/promises');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const HISTORY_DIR = path.join(DATA, 'history');
const FIELDS = [['sf', null], ['oneQB', null], ['sf_tep', 'sf'], ['sf_tepp', 'sf'], ['oneQB_tep', 'oneQB'], ['oneQB_tepp', 'oneQB']];
const SLEEPER_FIELDS = ['first_name', 'last_name', 'position', 'age', 'team', 'years_exp'];

function encodeSeries(values) {
  // values: array aligned to dates, null where missing. Returns [start, first, ...deltas]
  // with nulls for gaps, or null if the player never has a value.
  const start = values.findIndex(v => v != null);
  if (start < 0) return null;
  let end = values.length - 1;
  while (values[end] == null) end--;
  const out = [start, values[start]];
  let last = values[start];
  for (let i = start + 1; i <= end; i++) {
    if (values[i] == null) { out.push(null); continue; }
    out.push(values[i] - last);
    last = values[i];
  }
  return out;
}

async function buildHistory() {
  const hist = JSON.parse(await fs.readFile(path.join(DATA, 'player-value-history.json'), 'utf8'));
  const snaps = [...(hist.snapshots || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const dates = snaps.map(s => s.date);
  const names = new Set();
  snaps.forEach(s => Object.keys(s.players || {}).forEach(n => names.add(n)));
  await fs.mkdir(HISTORY_DIR, { recursive: true });

  for (const [field, fallback] of FIELDS) {
    const players = {};
    for (const name of names) {
      const series = snaps.map(s => {
        const e = s.players?.[name];
        if (!e) return null;
        const v = e[field] ?? (fallback ? e[fallback] : undefined);
        return Number.isFinite(v) ? Math.round(v) : null;
      });
      const enc = encodeSeries(series);
      if (enc) players[name] = enc;
    }
    const file = path.join(HISTORY_DIR, `players-${field}.json`);
    await fs.writeFile(file, JSON.stringify({ updated: new Date().toISOString(), dates, players }));
    console.log(`${path.basename(file)}: ${Object.keys(players).length} players`);
  }

  const stats = {};
  snaps.forEach((s, idx) => Object.entries(s.players || {}).forEach(([name, e]) => {
    if (!e.stats) return;
    (stats[name] ||= {})[idx] = e.stats;
  }));
  await fs.writeFile(path.join(HISTORY_DIR, 'player-stats.json'), JSON.stringify({ dates, players: stats }));
  console.log(`player-stats.json: ${Object.keys(stats).length} players`);
}

async function buildSleeperPlayers() {
  const res = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!res.ok) throw new Error('Sleeper players fetch failed: ' + res.status);
  const all = await res.json();
  const slim = {};
  for (const [id, p] of Object.entries(all)) {
    const o = {};
    for (const f of SLEEPER_FIELDS) if (p[f] != null) o[f] = p[f];
    slim[id] = o;
  }
  await fs.writeFile(path.join(DATA, 'sleeper-players.json'), JSON.stringify(slim));
  console.log(`sleeper-players.json: ${Object.keys(slim).length} players`);
}

(async () => {
  await buildHistory();
  await buildSleeperPlayers();
})().catch(e => { console.error(e); process.exit(1); });
