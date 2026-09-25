/* ============================================================
   BUILD WEEKLY STATS
   Every QB/RB/WR/TE's regular-season stats, week by week, plus team totals,
   for the Compare page's per-game stats, league-wide ranks, and team shares
   (target share, air-yards share, carry share, ...). Source: Sleeper's bulk
   weekly stats (one request per week, all players).

   Writes data/weekly/<season>.json:
     { season, updated, keys: [...stat keys],
       players: { pid: { n: name, p: pos, w: { week: [team, opp, away, ...values aligned to keys] } } },
       teamKeys: [...], teams: { TEAM: { week: [...sums aligned to teamKeys] } } }
   and data/weekly/index.json listing the seasons available.

   Usage:
     node scripts/build-weekly-stats.js            current season only (daily Action)
     node scripts/build-weekly-stats.js 2018 2025  a range, e.g. a one-time backfill
   ============================================================ */
const fs = require('fs/promises');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'weekly');
const POS = ['QB', 'RB', 'WR', 'TE'];
// Box-score and advanced fields worth keeping. Sleeper's own point totals and
// ranks (pts_*, rank_*) are left out on purpose: the site scores every week
// with each league's own settings instead.
const SKIP = /^(pts_|rank_|pos_rank_|idp_|st_|kr|pr|penalty|tm_def_snp|tm_st_snp|gms_active$)/;
// Longest-play fields are a per-week maximum, not something to add up.
const TEAM_KEYS = ['rec_tgt', 'rec_air_yd', 'rush_att', 'rec_yd', 'rec_td', 'rec_rz_tgt', 'rush_rz_att', 'pass_att'];

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error('Failed: ' + url);
}

async function buildSeason(season) {
  const weeks = +season <= 2020 ? 17 : 18;
  const rowsByWeek = [];
  for (let w = 1; w <= weeks; w++) {
    const url = `https://api.sleeper.com/stats/nfl/${season}/${w}?season_type=regular&` + POS.map(p => `position%5B%5D=${p}`).join('&');
    rowsByWeek.push([w, await getJson(url)]);
  }
  // Keys: every numeric stat any player recorded, minus the skipped groups.
  const keySet = new Set();
  rowsByWeek.forEach(([, rows]) => rows.forEach(r => Object.entries(r.stats || {}).forEach(([k, v]) => {
    if (typeof v === 'number' && v !== 0 && !SKIP.test(k)) keySet.add(k);
  })));
  const keys = [...keySet].sort();
  const players = {}, teams = {};
  let games = 0;
  rowsByWeek.forEach(([w, rows]) => rows.forEach(r => {
    const pos = r.player?.position;
    if (!POS.includes(pos) || !r.stats?.gp || !r.team) return;
    games++;
    const pl = players[r.player_id] ||= { n: `${r.player.first_name || ''} ${r.player.last_name || ''}`.trim(), p: pos, w: {} };
    pl.w[w] = [r.team, r.opponent || '', r.is_away_team ? 1 : 0, ...keys.map(k => {
      const v = r.stats[k];
      return typeof v === 'number' ? Math.round(v * 100) / 100 : 0;
    })];
    const t = (teams[r.team] ||= {});
    const sums = (t[w] ||= TEAM_KEYS.map(() => 0));
    TEAM_KEYS.forEach((k, i) => { sums[i] += r.stats[k] || 0; });
  }));
  Object.values(teams).forEach(t => Object.values(t).forEach(s => s.forEach((v, i) => { s[i] = Math.round(v * 100) / 100; })));
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, `${season}.json`), JSON.stringify({ season: String(season), updated: new Date().toISOString(), keys, players, teamKeys: TEAM_KEYS, teams }));
  console.log(`${season}: ${Object.keys(players).length} players, ${games} player-games, ${keys.length} stat keys`);
}

(async () => {
  let seasons = process.argv.slice(2).map(Number);
  if (seasons.length === 2) seasons = Array.from({ length: seasons[1] - seasons[0] + 1 }, (_, i) => seasons[0] + i);
  if (!seasons.length) {
    const state = await getJson('https://api.sleeper.app/v1/state/nfl');
    seasons = [+state.season];
  }
  for (const s of seasons) await buildSeason(s);
  const files = (await fs.readdir(OUT)).filter(f => /^\d{4}\.json$/.test(f)).map(f => f.slice(0, 4)).sort();
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify({ seasons: files }));
})().catch(e => { console.error(e); process.exit(1); });
