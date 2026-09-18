// One-time (not daily-snapshotted) pull of real END-OF-SEASON stat totals for
// every real NFL skill-position player currently relevant to dynasty (anyone in
// today's KTC rankings), going back to 2000. Re-run manually whenever you want to
// refresh it — this is NOT part of update-data.yml.
//
// Sleeper's /v1/stats/nfl/regular/{season} endpoint returns real season totals for
// every player in one call. Stored RAW (gp + the raw stat categories, not points/
// ppg/rank) rather than pre-scored — every league scores differently (PPR vs
// standard, TE premium, Superflex has no bearing on scoring but bonus categories
// vary a lot), so any league dot-products these against its own real
// scoring_settings at read time (Vault.scoreStats), same principle already used for
// live projections and KTC values elsewhere in this app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const KTC_PATH = path.join(DATA_DIR, 'ktc-values.json');
const OUT_PATH = path.join(DATA_DIR, 'player-history.json');
const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const EARLIEST_SEASON_FLOOR = 2000;

function normalizeName(s) {
  if (!s) return '';
  return s.toString().toLowerCase()
    .replace(/\./g, '').replace(/'/g, '')
    .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Jan/Feb still belongs to the prior season (playoffs); a season isn't "complete"
// stats-wise until it's actually finished, so the current season is never included.
function lastCompletedSeason() {
  const now = new Date();
  const year = now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
  return year - 1;
}

async function readJson(p) { return JSON.parse(await fs.readFile(p, 'utf8')); }

async function main() {
  const ktcData = await readJson(KTC_PATH);
  const players = await fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json());

  // Universal pool = every player KTC currently ranks (any dynasty-relevant name,
  // not filtered to one league's roster) — matched to Sleeper by normalized name.
  const trackedNames = new Set((ktcData.players || []).map(p => normalizeName(p.name)));
  const trackedIds = new Set(
    Object.entries(players)
      .filter(([, p]) => p && trackedNames.has(normalizeName(`${p.first_name || ''} ${p.last_name || ''}`.trim())))
      .map(([pid]) => pid)
  );
  console.log(`${trackedIds.size} of ${trackedNames.size} KTC-ranked players matched to Sleeper IDs.`);

  const rookieSeason = (p, fallbackFloor) => {
    if (p?.metadata?.rookie_year) return +p.metadata.rookie_year;
    if (p?.years_exp != null) return new Date().getFullYear() - p.years_exp;
    return fallbackFloor;
  };
  const lastSeason = lastCompletedSeason();
  const rookieYears = [...trackedIds].map(pid => rookieSeason(players[pid], lastSeason - 15));
  const earliestSeason = Math.max(EARLIEST_SEASON_FLOOR, Math.min(...rookieYears));
  const seasons = [];
  for (let y = earliestSeason; y <= lastSeason; y++) seasons.push(y);
  console.log(`Pulling ${seasons.length} season(s) — ${earliestSeason} through ${lastSeason}.`);

  const out = { generatedAt: new Date().toISOString(), seasons, players: {} };

  for (const season of seasons) {
    console.log(`Fetching ${season} season stats…`);
    const raw = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}`).then(r => r.json());
    Object.entries(raw).forEach(([pid, stats]) => {
      if (!trackedIds.has(pid)) return;
      if (!stats.gp) return; // didn't play that season — omit rather than store a bogus 0-gp row
      const p = players[pid] || {};
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      const pos = p.position || p.fantasy_positions?.[0];
      if (!SKILL_POSITIONS.includes(pos)) return;
      if (!out.players[pid]) out.players[pid] = { name, pos, seasons: {} };
      out.players[pid].seasons[season] = stats;
    });
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`Wrote raw season stats for ${Object.keys(out.players).length} players across seasons ${seasons.join(', ')} to ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
