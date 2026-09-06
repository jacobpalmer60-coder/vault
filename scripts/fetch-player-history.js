// One-time (not daily-snapshotted) pull of real season-final stats for every player
// currently rostered in the tracked league, going back a few completed NFL seasons.
// Re-run manually whenever you want to refresh it (e.g. once a year, after a season
// wraps) — this is NOT part of the daily update-data.yml Action.
//
// Sleeper's /v1/stats/nfl/regular/{season} endpoint returns real END-OF-SEASON stat
// totals for every player in one call (no need to sum 18 weekly calls). Points and
// rank are computed ourselves from those raw stats using THIS league's actual
// scoring_settings — not Sleeper's own pts_ppr/rank_ppr fields, which assume a
// generic PPR format that won't match superflex/TE-premium/etc.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEAGUE_ID = '1313454100225990656'; // The Vault's tracked league.
const OUT_PATH = path.join(__dirname, '..', 'data', 'player-history.json');
const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const SEASONS_BACK = 3;

function scoreStats(stats, scoringSettings) {
  let total = 0;
  for (const [k, w] of Object.entries(scoringSettings || {})) total += (stats[k] || 0) * w;
  return total;
}

// Jan/Feb still belongs to the prior season (playoffs); a season isn't "complete"
// stats-wise until it's actually finished, so the current season is never included.
function lastCompletedSeason() {
  const now = new Date();
  const year = now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
  return year - 1;
}

async function main() {
  const [league, rosters, players] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
    fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json())
  ]);
  if (!league || league.error) throw new Error('League not found.');

  const rosteredIds = new Set(rosters.flatMap(r => (r.players || []).map(String)));
  console.log(`${rosteredIds.size} rostered players to track.`);

  const lastSeason = lastCompletedSeason();
  const seasons = Array.from({ length: SEASONS_BACK }, (_, i) => lastSeason - i).sort();

  const out = { leagueId: LEAGUE_ID, generatedAt: new Date().toISOString(), seasons, players: {} };

  for (const season of seasons) {
    console.log(`Fetching ${season} season stats…`);
    const raw = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}`).then(r => r.json());

    // Score every skill-position player in the league (not just ours) so rank is
    // meaningful — "posRank 12" should mean 12th among every real NFL RB that
    // season, not 12th among the dozen RBs that happen to be on our rosters.
    const scored = [];
    Object.entries(raw).forEach(([pid, stats]) => {
      const p = players[pid];
      const pos = p?.position || p?.fantasy_positions?.[0];
      if (!pos || !SKILL_POSITIONS.includes(pos)) return;
      const points = scoreStats(stats, league.scoring_settings);
      const gp = stats.gp || 0;
      scored.push({ pid, pos, points, gp });
    });

    const overallSorted = [...scored].sort((a, b) => b.points - a.points);
    const overallRank = new Map(overallSorted.map((s, i) => [s.pid, i + 1]));

    const posRank = new Map();
    SKILL_POSITIONS.forEach(pos => {
      [...scored].filter(s => s.pos === pos).sort((a, b) => b.points - a.points)
        .forEach((s, i) => posRank.set(s.pid, i + 1));
    });

    scored.forEach(s => {
      if (!rosteredIds.has(s.pid)) return;
      if (!s.gp) return; // Didn't play that season (not in the league yet, hurt all year,
      // etc.) — storing a "#580 rank, 0.0 points" row for a year before a rookie was
      // drafted reads as a bad season rather than "not in the NFL yet", so skip it.
      const p = players[s.pid] || {};
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      if (!out.players[s.pid]) out.players[s.pid] = { name, pos: s.pos, seasons: {} };
      out.players[s.pid].seasons[season] = {
        points: +s.points.toFixed(1),
        gp: s.gp,
        ppg: +(s.points / s.gp).toFixed(2),
        posRank: posRank.get(s.pid),
        overallRank: overallRank.get(s.pid)
      };
    });
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`Wrote history for ${Object.keys(out.players).length} rostered players across seasons ${seasons.join(', ')} to ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
