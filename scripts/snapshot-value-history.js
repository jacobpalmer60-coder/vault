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

const PICK_ROUNDS = [1, 2, 3, 4]; // mirrors VAULT_CONFIG.PICK_ROUNDS
const PICK_YEARS_WINDOW = 4; // mirrors VAULT_CONFIG.PICK_YEARS_WINDOW

// Mirrors Vault.seasonDraftComplete/Vault.futurePickYears — a pick's year stops
// being a real tradeable asset once that season's rookie draft has happened.
function futurePickYears(league, drafts) {
  const season = +league.season;
  const window = Array.from({ length: PICK_YEARS_WINDOW }, (_, i) => season + i);
  return window.filter(year => !(drafts || []).some(d =>
    String(d.season) === String(year) && d.status === 'complete' &&
    d.settings && d.settings.rounds === PICK_ROUNDS.length
  ));
}

// Mirrors Vault.buildKtcPickMap — maps this league's future pick years to KTC's
// nearest priced draft class (KTC's grid can lag a year behind).
function buildKtcPickMap(ktcData, isSF, years) {
  const raw = new Map();
  const seasons = new Set();
  (ktcData.picks || []).forEach(p => {
    raw.set(`${p.season}-${p.round}-${p.slot}`, isSF ? p.sf_tep : p.oneQB_tep);
    seasons.add(p.season);
  });
  const availYears = [...seasons].sort((a, b) => a - b);
  const map = new Map();
  if (!availYears.length) return map;
  years.forEach(year => {
    const nearest = availYears.reduce((best, y) => Math.abs(y - year) < Math.abs(best - year) ? y : best, availYears[0]);
    PICK_ROUNDS.forEach(round => {
      ['early', 'mid', 'late'].forEach(tier => {
        const val = raw.get(`${nearest}-${round}-${tier}`);
        if (val != null) map.set(`${year}-${round}-${tier}`, val);
      });
    });
  });
  return map;
}

// Mirrors Vault.ktcPickSlot — converts an overall pick number into KTC's
// round/tier pricing buckets (12-team-pace convention; see vault-core.js for why).
function ktcPickSlot(overallPick) {
  const round = Math.min(4, Math.max(1, Math.ceil(overallPick / 12)));
  const pos = ((overallPick - 1) % 12) + 1;
  const tier = pos <= 4 ? 'early' : pos <= 8 ? 'mid' : 'late';
  return { round, tier };
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const [league, users, rosters, players, traded, drafts, ktcData, projData] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
    fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/traded_picks`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/drafts`).then(r => r.json()).catch(() => []),
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
    let playerValue = 0;
    const plist = [];
    (r.players || []).forEach(pid => {
      const p = players[String(pid)];
      if (!p) return;
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const key = normalizeName(name);
      const value = valueByName.get(key) || 0;
      const ppg = ppgByPid.get(String(pid)) || 0;
      playerValue += value;
      plist.push({ id: String(pid), pos: p.position || '', ppg });
      if (value > 0 || ppg > 0) playerSnaps[key] = { value, ppg: +ppg.toFixed(2) };
    });
    const optPpg = optimalLineup(plist, slots);
    return { rosterId: r.roster_id, teamName, playerValue: Math.round(playerValue), optPpg: +optPpg.toFixed(1) };
  });

  // Mirrors buildLeagueTeams' pick-ownership/pricing block in vault-core.js — a
  // team's real dynasty value includes the picks it holds, not just rostered
  // players, so "total" here has to fold picksValue in the same way the live
  // League Overview page already does (its separate "Total"/"Picks" columns).
  const pickYears = futurePickYears(league, drafts);
  const pickMap = buildKtcPickMap(ktcData, isSF, pickYears);
  const pickOwner = new Map();
  pickYears.forEach(y => PICK_ROUNDS.forEach(rnd => rosters.forEach(ro => pickOwner.set(`${y}-${rnd}-${ro.roster_id}`, ro.roster_id))));
  (traded || []).filter(p => pickYears.includes(+p.season)).forEach(p => {
    const to = Number(p.owner_id);
    if (to && to !== p.roster_id) pickOwner.set(`${p.season}-${p.round}-${p.roster_id}`, to);
  });
  const own = new Map(rosters.map(r => [r.roster_id, []]));
  pickOwner.forEach((owner, k) => {
    const [season, round, original] = k.split('-').map(Number);
    own.get(owner).push({ season, round, original });
  });

  // Draft order rank (1 = worst team, picks first; n = best team, picks last) —
  // same "best optPpg picks last" convention buildLeagueTeams uses, so a pick's
  // overall slot (and therefore its KTC tier) matches what the live pages show.
  const sorted = [...teams].sort((a, b) => b.optPpg - a.optPpg);
  const n = sorted.length;
  const draftRank = new Map(sorted.map((t, k) => [t.rosterId, n - k]));
  teams.forEach(t => {
    const picks = own.get(t.rosterId) || [];
    const picksValue = picks.reduce((sum, p) => {
      const rank = draftRank.get(p.original) || 1;
      const overall = (p.round - 1) * n + rank;
      const { round: ktcRound, tier } = ktcPickSlot(overall);
      return sum + (pickMap.get(`${p.season}-${ktcRound}-${tier}`) || 0);
    }, 0);
    t.picksValue = Math.round(picksValue);
    t.total = t.playerValue + t.picksValue;
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
