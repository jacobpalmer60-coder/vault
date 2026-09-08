// Fetches fantasy projections from Sleeper's (undocumented but public, CORS-enabled)
// projections API and writes data/projections.json.
//
// Each entry is keyed by Sleeper's own player_id — the same ID used in league rosters,
// so no name-matching is needed. We store raw per-category projected stats (receptions,
// yards, TDs, etc.) rather than precomputed fantasy points: every league scores
// differently (PPR vs half-PPR, TE premium, first-down bonuses...), and vault-core.js
// dot-products these against each league's *actual* `scoring_settings` from Sleeper to
// get an exact, league-accurate projection instead of assuming one generic format.
//
// Hybrid of two Sleeper endpoints, because neither alone covers everything:
//  - The per-week endpoint (weeks 1-FANTASY_WEEKS, summed) gives real opponent-by-
//    opponent projections and each player's own real bye week (gp = actual weeks
//    with a projection). But Sleeper only models real weekly production for the
//    ~470 players who matter for a given week — everyone else's weekly row is just
//    an ADP placeholder with no per-category stats at all.
//  - The season-long endpoint covers the full ~3000-player universe (every dynasty
//    stash and deep bench piece), but reports the same gp:18 placeholder for every
//    player (the week count of the season, not a real games-played figure), and its
//    season total doesn't equal the sum of its own weekly projections for reasons
//    Sleeper doesn't expose (checked directly — e.g. Christian McCaffrey's season
//    total sits ~22% below the sum of his 18 weekly projections).
// So: use the real weekly sum wherever Sleeper actually provides one (real variance,
// real bye), and fall back to the season-long total for everyone else, dividing it
// by FANTASY_WEEKS - 1 rather than trusting Sleeper's placeholder gp — this league's
// regular season is 17 weeks with one bye apiece, so 16 real games is the right
// denominator regardless of which of a player's 17 real-life games falls in NFL
// week 18 (outside this league's season).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const DROP_PREFIXES = ['adp_', 'pos_rank_', 'rank_'];
const DROP_KEYS = new Set(['cmp_pct', 'pts_ppr', 'pts_half_ppr', 'pts_std']);
const FANTASY_WEEKS = 17;
const FALLBACK_GAMES = FANTASY_WEEKS - 1;

function currentSeason() {
  const now = new Date();
  // Jan/Feb still belongs to the prior season (playoffs); Sleeper's projections for
  // the new season are reliably up by March.
  return now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
}

function filterStats(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats || {})) {
    if (DROP_KEYS.has(k)) continue;
    if (DROP_PREFIXES.some(p => k.startsWith(p))) continue;
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

async function main() {
  const season = currentSeason();
  const [seasonRows, ...weeks] = await Promise.all([
    fetch(`https://api.sleeper.app/projections/nfl/${season}?season_type=regular`).then(r => {
      if (!r.ok) throw new Error(`Season fetch failed: ${r.status} ${r.statusText}`);
      return r.json();
    }),
    ...Array.from({ length: FANTASY_WEEKS }, (_, i) => i + 1).map(week =>
      fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular`).then(r => {
        if (!r.ok) throw new Error(`Week ${week} fetch failed: ${r.status} ${r.statusText}`);
        return r.json();
      })
    )
  ]);

  // Base coverage: every skill-position player Sleeper has a season-long row for,
  // with gp overridden to the real fallback games figure (see header comment).
  const players = {};
  for (const row of seasonRows) {
    const pos = row.player && row.player.position;
    if (!SKILL_POSITIONS.includes(pos)) continue;
    if (!row.player_id) continue;
    const stats = filterStats(row.stats);
    stats.gp = FALLBACK_GAMES;
    players[row.player_id] = {
      name: `${row.player.first_name || ''} ${row.player.last_name || ''}`.trim(),
      pos,
      team: row.player.team || '',
      stats
    };
  }

  // Overlay real weekly sums wherever Sleeper actually provides them, replacing
  // the season-long fallback entirely (real gp, real per-week variance) rather
  // than blending the two together.
  const weeklySums = {};
  for (const rows of weeks) {
    for (const row of rows) {
      const pos = row.player && row.player.position;
      if (!SKILL_POSITIONS.includes(pos)) continue;
      if (!row.player_id) continue;
      const weekStats = filterStats(row.stats);
      if (!Object.keys(weekStats).length) continue; // bye week / no real projection this week
      let acc = weeklySums[row.player_id];
      if (!acc) acc = weeklySums[row.player_id] = { name: `${row.player.first_name || ''} ${row.player.last_name || ''}`.trim(), pos, team: row.player.team || '', stats: {} };
      for (const [k, v] of Object.entries(weekStats)) acc.stats[k] = (acc.stats[k] || 0) + v;
    }
  }
  for (const [pid, p] of Object.entries(weeklySums)) players[pid] = p;

  const count = Object.keys(players).length;
  if (count < 500) {
    throw new Error(`Only got ${count} skill-position players — API shape probably changed, refusing to overwrite`);
  }
  const weeklyCount = Object.keys(weeklySums).length;

  const payload = {
    source: 'api.sleeper.app/projections (weekly sum where available, season-long fallback otherwise)',
    season,
    updated: new Date().toISOString(),
    count,
    players
  };

  const outPath = path.join(__dirname, '..', 'data', 'projections.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote ${count} players (season ${season}) to ${outPath} — ${weeklyCount} from real weekly sums, ${count - weeklyCount} from season-long fallback.`);
}

main().catch(e => { console.error(e); process.exit(1); });
