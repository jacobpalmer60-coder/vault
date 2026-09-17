// Adds real historical PPG to the same snapshot-shaped data the KTC value
// backfill (backfill-player-value-history.js) just deepened, using stats we
// already have fully fetched and validated: data/player-history.json (real
// END-OF-SEASON stats per rostered player, scored to this league's settings,
// produced by the existing fetch-player-history.js — see that script for how
// it's built). Reusing it here instead of re-fetching Sleeper's weekly stats
// from scratch avoids a second, separate multi-hundred-request job for data we
// already have; the tradeoff is one real PPG checkpoint per season rather than
// week-by-week — a season's mid-year role change won't show as a mid-season
// bend, only as the jump between two season checkpoints.
//
// Each season's real final PPG gets stamped onto whichever EXISTING snapshot
// date (already present from the value backfill) falls closest to that
// season's real close — never invents a new date. A season with no nearby
// existing date (older than the value backfill's own range) is simply skipped,
// which naturally keeps the PPG trend's range matched to the value trend's.
//
// Run manually, after backfill-player-value-history.js:
//   node scripts/backfill-player-ppg-history.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PLAYER_HISTORY_PATH = path.join(DATA_DIR, 'player-value-history.json');
const SEASON_STATS_PATH = path.join(DATA_DIR, 'player-history.json');

function normalizeName(s) {
  if (!s) return '';
  return s.toString().toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

// A season's real close is roughly mid-January of the following year (regular
// season plus most of the playoffs done) — precise to the day doesn't matter
// for a multi-year trend, only landing in the right multi-week neighborhood.
function seasonCloseDate(season) {
  return `${+season + 1}-01-15`;
}

async function main() {
  const valueHistory = await readJson(PLAYER_HISTORY_PATH);
  const seasonStats = await readJson(SEASON_STATS_PATH);

  const allDates = valueHistory.snapshots.map(s => s.date).sort();
  if (!allDates.length) throw new Error('player-value-history.json has no snapshots — run backfill-player-value-history.js first.');
  const snapByDate = new Map(valueHistory.snapshots.map(s => [s.date, s]));

  // Closest existing date to a target, but only within ~45 days — otherwise a
  // season with no real coverage nearby would silently snap to some unrelated
  // far-off day.
  function closestDate(target) {
    let best = null, bestDiff = Infinity;
    for (const d of allDates) {
      const diff = Math.abs(new Date(d) - new Date(target));
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    }
    const MAX_MS = 45 * 24 * 60 * 60 * 1000;
    return bestDiff <= MAX_MS ? best : null;
  }

  let stamped = 0, seasonsSkipped = 0;
  Object.values(seasonStats.players).forEach(p => {
    const key = normalizeName(p.name);
    if (!key) return;
    Object.entries(p.seasons || {}).forEach(([season, s]) => {
      if (!(s.ppg > 0)) return;
      const target = seasonCloseDate(season);
      const date = closestDate(target);
      if (!date) { seasonsSkipped++; return; }
      const snap = snapByDate.get(date);
      if (!snap.players[key]) snap.players[key] = {};
      snap.players[key].ppg = s.ppg;
      stamped++;
    });
  });

  valueHistory.snapshots = [...snapByDate.values()].sort((a, b) => a.date < b.date ? -1 : 1);
  await fs.writeFile(PLAYER_HISTORY_PATH, JSON.stringify(valueHistory));
  console.log(`Stamped ${stamped} season-PPG checkpoints onto existing dates (${seasonsSkipped} seasons had no nearby date to attach to).`);
}

main().catch(e => { console.error(e); process.exit(1); });
