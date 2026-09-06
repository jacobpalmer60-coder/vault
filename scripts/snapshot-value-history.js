// Daily snapshot of team totals and rostered-player values for the tracked league,
// so League Overview and Player Rankings can chart value over time. Runs as part of
// the same daily Action as the other data refreshes — one snapshot per calendar day
// (a manual re-run same day is a no-op, not a duplicate entry).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
// The Vault's tracked league — this is a personal single-league tool, not
// multi-tenant, so the league to snapshot is pinned rather than configurable here.
const LEAGUE_ID = '1313454100225990656';
const TEAM_HISTORY_PATH = path.join(DATA_DIR, 'team-value-history.json');
const PLAYER_HISTORY_PATH = path.join(DATA_DIR, 'player-value-history.json');
// Bounds file growth — ~1.5yrs of team history, ~4 months of (much larger) player history.
const MAX_TEAM_SNAPSHOTS = 550;
const MAX_PLAYER_SNAPSHOTS = 120;

// Mirrors Vault.normalizeName in vault-core.js — must match exactly, since this is
// how KTC's name-only data gets matched against Sleeper's player database both here
// and client-side. Keep any change to one in sync with the other.
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

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const [league, users, rosters, players, ktcData] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
    fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
    readJson(path.join(DATA_DIR, 'ktc-values.json'), null)
  ]);
  if (!league || league.error) throw new Error('League not found.');
  if (!ktcData) throw new Error('data/ktc-values.json missing — run fetch-ktc.js first.');

  const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
  const valueByName = new Map();
  (ktcData.players || []).forEach(p => {
    const key = normalizeName(p.name);
    if (key) valueByName.set(key, isSF ? p.sf_tep : p.oneQB_tep);
  });

  const userMap = new Map(users.map(u => [u.user_id, u]));
  const playerValues = {};
  const teams = rosters.map(r => {
    const u = userMap.get(r.owner_id) || {};
    const teamName = u.metadata?.team_name || u.display_name || 'Team';
    let total = 0;
    (r.players || []).forEach(pid => {
      const p = players[String(pid)];
      if (!p) return;
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const key = normalizeName(name);
      const value = valueByName.get(key) || 0;
      total += value;
      if (value > 0) playerValues[key] = value;
    });
    return { rosterId: r.roster_id, teamName, total: Math.round(total) };
  });

  const teamHistory = await readJson(TEAM_HISTORY_PATH, { leagueId: LEAGUE_ID, snapshots: [] });
  const playerHistory = await readJson(PLAYER_HISTORY_PATH, { leagueId: LEAGUE_ID, snapshots: [] });

  [teamHistory, playerHistory].forEach(h => {
    if (h.snapshots.length && h.snapshots[h.snapshots.length - 1].date === today) {
      h.snapshots.pop(); // Same-day re-run (e.g. manual dispatch) replaces, not duplicates.
    }
  });

  teamHistory.leagueId = LEAGUE_ID;
  teamHistory.snapshots.push({ date: today, teams });
  if (teamHistory.snapshots.length > MAX_TEAM_SNAPSHOTS) teamHistory.snapshots = teamHistory.snapshots.slice(-MAX_TEAM_SNAPSHOTS);

  playerHistory.leagueId = LEAGUE_ID;
  playerHistory.snapshots.push({ date: today, players: playerValues });
  if (playerHistory.snapshots.length > MAX_PLAYER_SNAPSHOTS) playerHistory.snapshots = playerHistory.snapshots.slice(-MAX_PLAYER_SNAPSHOTS);

  await fs.writeFile(TEAM_HISTORY_PATH, JSON.stringify(teamHistory));
  await fs.writeFile(PLAYER_HISTORY_PATH, JSON.stringify(playerHistory));
  console.log(`Snapshotted ${teams.length} teams and ${Object.keys(playerValues).length} rostered players for ${today}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
