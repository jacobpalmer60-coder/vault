// Daily snapshot of team totals/Opt PPG and rostered-player value/PPG for the
// tracked league, so League Overview and Player Rankings can chart trends over
// time. Runs as part of the same daily Action as the other data refreshes — one
// snapshot per calendar day (a manual re-run same day is a no-op, not a duplicate).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
// The Vault's tracked league — this is a personal single-league tool, not
// multi-tenant, so the league to snapshot is pinned rather than configurable here.
const LEAGUE_ID = '1313454100225990656';
// Mirrors Vault.REGULAR_SEASON_GAMES — see that constant's comment in vault-core.js.
const REGULAR_SEASON_GAMES = 17;
const TEAM_HISTORY_PATH = path.join(DATA_DIR, 'team-value-history.json');
const PLAYER_HISTORY_PATH = path.join(DATA_DIR, 'player-value-history.json');
// Bounds file growth. At measured real sizes (~774 bytes/snapshot for team, ~14KB/snapshot
// for player, both keyed by rostered-player count), these give 10yrs of team history
// (~2.8MB) and ~7yrs of player history (~36MB) before the oldest day starts rolling off —
// comfortable margin past the 5yr target even if the roster grows, and well under GitHub's
// 100MB hard per-file limit (50MB soft warning).
const MAX_TEAM_SNAPSHOTS = 3650;
const MAX_PLAYER_SNAPSHOTS = 2600;

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

// Mirrors Vault.scoreStats — dot-products raw projected stat counts against this
// league's actual scoring_settings, so PPG matches how points are really scored here.
function scoreStats(stats, scoringSettings) {
  let total = 0;
  for (const [k, w] of Object.entries(scoringSettings || {})) total += (stats[k] || 0) * w;
  return total;
}

// Mirrors Vault.optimalLineup — best-PPG lineup a roster can field given the
// league's actual starting slots (FLEX/SUPER_FLEX/etc. eligibility included).
function optimalLineup(plist, slots) {
  const pool = [...plist].sort((a, b) => b.ppg - a.ppg);
  const used = new Set();
  let tot = 0;
  for (const slot of slots) {
    let allowed = [slot];
    if (slot === 'FLEX') allowed = ['RB', 'WR', 'TE'];
    if (slot === 'SUPER_FLEX') allowed = ['QB', 'RB', 'WR', 'TE'];
    if (slot === 'WRRB_FLEX') allowed = ['RB', 'WR'];
    if (slot === 'REC_FLEX') allowed = ['WR', 'TE'];
    const i = pool.findIndex(p => !used.has(p.id) && allowed.includes(p.pos));
    if (i >= 0) { tot += pool[i].ppg; used.add(pool[i].id); }
  }
  return tot;
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const [league, users, rosters, players, ktcData, projData] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
    fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
    readJson(path.join(DATA_DIR, 'ktc-values.json'), null),
    readJson(path.join(DATA_DIR, 'projections.json'), null)
  ]);
  if (!league || league.error) throw new Error('League not found.');
  if (!ktcData) throw new Error('data/ktc-values.json missing — run fetch-ktc.js first.');
  if (!projData) throw new Error('data/projections.json missing — run fetch-projections.js first.');

  const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
  const valueByName = new Map();
  (ktcData.players || []).forEach(p => {
    const key = normalizeName(p.name);
    if (key) valueByName.set(key, isSF ? p.sf_tep : p.oneQB_tep);
  });

  // Projections are keyed by Sleeper player_id (no name-matching needed, unlike KTC).
  const ppgByPid = new Map();
  Object.entries(projData.players || {}).forEach(([pid, p]) => {
    // p.stats.gp is unusable as the PPG divisor — Sleeper reports the same gp:18
    // for every single skill-position player, which is the week-count of the season,
    // not a real per-player games-played projection (real ceiling is 17, mirrors
    // Vault.REGULAR_SEASON_GAMES). Only used here as an eligibility check.
    if (p.stats?.gp) ppgByPid.set(pid, scoreStats(p.stats, league.scoring_settings) / REGULAR_SEASON_GAMES);
  });

  const slots = (league.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s));
  const userMap = new Map(users.map(u => [u.user_id, u]));
  const playerSnaps = {};
  const teams = rosters.map(r => {
    const u = userMap.get(r.owner_id) || {};
    const teamName = u.metadata?.team_name || u.display_name || 'Team';
    let total = 0;
    const plist = [];
    (r.players || []).forEach(pid => {
      const p = players[String(pid)];
      if (!p) return;
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const key = normalizeName(name);
      const value = valueByName.get(key) || 0;
      const ppg = ppgByPid.get(String(pid)) || 0;
      total += value;
      plist.push({ id: String(pid), pos: p.position || '', ppg });
      if (value > 0 || ppg > 0) playerSnaps[key] = { value, ppg: +ppg.toFixed(2) };
    });
    const optPpg = optimalLineup(plist, slots);
    return { rosterId: r.roster_id, teamName, total: Math.round(total), optPpg: +optPpg.toFixed(1) };
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
  playerHistory.snapshots.push({ date: today, players: playerSnaps });
  if (playerHistory.snapshots.length > MAX_PLAYER_SNAPSHOTS) playerHistory.snapshots = playerHistory.snapshots.slice(-MAX_PLAYER_SNAPSHOTS);

  await fs.writeFile(TEAM_HISTORY_PATH, JSON.stringify(teamHistory));
  await fs.writeFile(PLAYER_HISTORY_PATH, JSON.stringify(playerHistory));
  console.log(`Snapshotted ${teams.length} teams and ${Object.keys(playerSnaps).length} rostered players (value + PPG) for ${today}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
