// Fetches season-long fantasy projections from Sleeper's (undocumented but public,
// CORS-enabled) projections API and writes data/projections.json.
//
// Each entry is keyed by Sleeper's own player_id — the same ID used in league rosters,
// so no name-matching is needed. We store raw per-category projected stats (receptions,
// yards, TDs, etc.) rather than precomputed fantasy points: every league scores
// differently (PPR vs half-PPR, TE premium, first-down bonuses...), and vault-core.js
// dot-products these against each league's *actual* `scoring_settings` from Sleeper to
// get an exact, league-accurate projection instead of assuming one generic format.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const DROP_PREFIXES = ['adp_', 'pos_rank_', 'rank_'];
const DROP_KEYS = new Set(['cmp_pct', 'pts_ppr', 'pts_half_ppr', 'pts_std']);

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
  const res = await fetch(`https://api.sleeper.app/projections/nfl/${season}?season_type=regular`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const rows = await res.json();

  const players = {};
  for (const row of rows) {
    const pos = row.player && row.player.position;
    if (!SKILL_POSITIONS.includes(pos)) continue;
    if (!row.player_id) continue;
    players[row.player_id] = {
      name: `${row.player.first_name || ''} ${row.player.last_name || ''}`.trim(),
      pos,
      team: row.player.team || '',
      stats: filterStats(row.stats)
    };
  }

  const count = Object.keys(players).length;
  if (count < 500) {
    throw new Error(`Only got ${count} skill-position players — API shape probably changed, refusing to overwrite`);
  }

  const payload = {
    source: 'api.sleeper.app/projections',
    season,
    updated: new Date().toISOString(),
    count,
    players
  };

  const outPath = path.join(__dirname, '..', 'data', 'projections.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote ${count} players (season ${season}) to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
