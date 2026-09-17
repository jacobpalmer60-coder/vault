// Completes the League Overview trend chart's `total` (playerValue + picksValue)
// for every day backfill-team-value-history.js already reconstructed, by also
// backfilling real historical pick values and replaying real pick TRADES.
//
// KTC's pick profile pages carry the same full daily history a player's does
// (confirmed live: "2027 Early 1st" has tracked prices back to 2023). This
// treats each (season, tier, round) label as one continuously-priced asset and
// replays real pick trades (a trade's draft_picks field: {season, round,
// roster_id (whose own slot it is), owner_id, previous_owner_id} — a direct
// ownership-transfer event) to know which roster held which pick on which day.
//
// One deliberate simplification, disclosed rather than hidden: a pick's TIER
// (early/mid/late) is assigned ONCE using today's real standings-based draft
// order (mirrors Vault.ktcPickSlot/buildLeagueTeams exactly) and held constant
// across the whole replay — recomputing tier for every historical day would
// mean reconstructing full historical standings, a separate, larger task. This
// means a team whose season started poorly and improved won't show their pick
// re-tiering mid-year, only real price drift and real trade-driven ownership
// changes. Also: this league's 2026 picks resolved into real players at the
// May 2026 rookie draft and are no longer tracked as future assets at all —
// so picksValue for the Feb-April 2026 window (before that draft) understates
// what was actually a real, valuable asset class at the time. Both tradeoffs
// are about scope, not correctness of what IS computed.
//
// Run manually, after backfill-team-value-history.js:
//   node scripts/backfill-picks-value-history.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LEAGUE_ID = '1313454100225990656';
const TEAM_HISTORY_PATH = path.join(DATA_DIR, 'team-value-history.json');

const PICK_YEARS_WINDOW = 4;
const PICK_ROUNDS = [1, 2, 3, 4];
const RANKINGS_URL = 'https://keeptradecut.com/dynasty-rankings';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
};
const REQUEST_DELAY_MS = 500;

function dateStr(d) { return d.toISOString().slice(0, 10); }

function ktcTepTier(bonusRecTe) {
  const b = +bonusRecTe || 0;
  if (b < 0.25) return 'plain';
  if (b < 0.75) return 'tep';
  return 'tepp';
}

function extractJsonScriptTag(html, id) {
  const openTag = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>`));
  if (!openTag) return null;
  const start = openTag.index + openTag[0].length;
  const end = html.indexOf('</script>', start);
  if (end === -1) return null;
  return JSON.parse(html.slice(start, end));
}

function pickBlendHistory(detail, tier) {
  const fields = tier === 'plain' ? { blend: 'blendValueHistory' } : { blend: 'blendHistory' };
  const source = tier === 'plain' ? detail : (detail[tier] || {});
  const blend = source[fields.blend] || [];
  if (blend.length || tier === 'plain') return blend;
  return detail.blendValueHistory || [];
}

function parseKtcDate(d) {
  const yy = +d.slice(0, 2), mm = d.slice(2, 4), dd = d.slice(4, 6);
  const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

// Mirrors Vault.ktcPickSlot exactly — converts an overall pick number into
// KTC's round/tier pricing bucket (12-team-pace convention).
function ktcPickSlot(overallPick) {
  const round = Math.min(4, Math.max(1, Math.ceil(overallPick / 12)));
  const pos = ((overallPick - 1) % 12) + 1;
  const tier = pos <= 4 ? 'early' : pos <= 8 ? 'mid' : 'late';
  return { round, tier };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function readJson(p) { return JSON.parse(await fs.readFile(p, 'utf8')); }

async function main() {
  console.log('Fetching league, rosters, players, ktc values, drafts, transactions...');
  const [league, rosters, sleeperPlayers, drafts, tradedPicks] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
    fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/drafts`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/traded_picks`).then(r => r.json())
  ]);
  const users = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`).then(r => r.json());
  const userById = new Map(users.map(u => [u.user_id, u]));
  const teamNameOf = new Map(rosters.map(r => {
    const u = userById.get(r.owner_id) || {};
    return [r.roster_id, u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`];
  }));

  const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
  const tier = ktcTepTier(league.scoring_settings?.bonus_rec_te);

  const weeks = await Promise.all(
    [...Array(18)].map((_, i) => fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/transactions/${i + 1}`).then(r => r.json()).catch(() => []))
  );
  const transactions = weeks.flat().filter(t => t && t.status === 'complete');

  // Which future seasons are still trackable picks (drafted seasons drop out).
  function seasonDraftComplete(season) {
    return drafts.some(d => String(d.season) === String(season) && d.status === 'complete' && d.settings?.rounds === PICK_ROUNDS.length);
  }
  const season0 = +league.season;
  const pickYears = Array.from({ length: PICK_YEARS_WINDOW }, (_, i) => season0 + i).filter(y => !seasonDraftComplete(y));
  console.log(`Tracked pick years: ${pickYears.join(', ')}`);

  // Need each team's optPpg to rank draft order the same way buildLeagueTeams
  // does — requires today's real player values/projections, same as the daily
  // snapshot script.
  const ktcData = await readJson(path.join(DATA_DIR, 'ktc-values.json'));
  const projData = await readJson(path.join(DATA_DIR, 'projections.json'));
  const valueField = (isSF ? 'sf' : 'oneQB') + (tier === 'plain' ? '' : `_${tier}`);
  const valueByName = new Map();
  (ktcData.players || []).forEach(p => {
    const key = normalizeName(p.name);
    if (key) valueByName.set(key, p[valueField]);
  });
  function scoreStats(stats, scoringSettings) {
    let total = 0;
    for (const [k, w] of Object.entries(scoringSettings || {})) total += (stats[k] || 0) * w;
    return total;
  }
  const ppgByPid = new Map();
  Object.entries(projData.players || {}).forEach(([pid, p]) => {
    if (p.stats?.gp) ppgByPid.set(pid, scoreStats(p.stats, league.scoring_settings) / p.stats.gp);
  });
  const slots = (league.roster_positions || []).filter(s => !['BN', 'IR', 'TAXI'].includes(s));
  function optimalLineup(plist) {
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
  function normalizeName(s) {
    if (!s) return '';
    return s.toString().toLowerCase().replace(/\./g, '').replace(/'/g, '')
      .replace(/ jr$| sr$| ii$| iii$| iv$| v$/, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  const optByRoster = new Map(rosters.map(r => {
    const plist = (r.players || []).map(pid => {
      const p = sleeperPlayers[String(pid)];
      if (!p) return null;
      return { id: String(pid), pos: p.position || '', ppg: ppgByPid.get(String(pid)) || 0 };
    }).filter(Boolean);
    return [r.roster_id, optimalLineup(plist)];
  }));
  const sortedByOpt = [...rosters].sort((a, b) => optByRoster.get(b.roster_id) - optByRoster.get(a.roster_id));
  const n = sortedByOpt.length;
  const draftRank = new Map(sortedByOpt.map((r, i) => [r.roster_id, n - i]));

  // Every (season, round, original-roster) pick asset in the tracked window,
  // with its tier fixed by today's real standings-based draft order.
  const pickAssets = []; // { season, round, originalRoster, tier }
  pickYears.forEach(season => PICK_ROUNDS.forEach(round => rosters.forEach(r => {
    const rank = draftRank.get(r.roster_id);
    const overall = (round - 1) * n + rank;
    const { tier: pickTier } = ktcPickSlot(overall);
    pickAssets.push({ season, round, originalRoster: r.roster_id, tier: pickTier });
  })));

  // Distinct (season, round, tier) labels actually needed — usually far fewer
  // than pickAssets.length since many teams share the same tier per round.
  const labelKey = a => `${a.season}-${a.round}-${a.tier}`;
  const neededLabels = [...new Set(pickAssets.map(labelKey))];
  console.log(`${pickAssets.length} pick assets across ${neededLabels.length} distinct (season, round, tier) prices to fetch.`);

  console.log('Fetching bulk rankings page for pick slug lookup...');
  const rankingsHtml = await fetch(RANKINGS_URL, { headers: HEADERS }).then(r => r.text());
  const allEntries = extractJsonScriptTag(rankingsHtml, 'ktc-players');
  const pickNamePattern = /^(\d{4})\s+(Early|Mid|Late)\s+(\d+)(?:st|nd|rd|th)$/i;
  const ROUND_ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
  const slugByLabel = new Map();
  allEntries.filter(p => p.position === 'RDP').forEach(p => {
    const m = p.playerName.match(pickNamePattern);
    if (!m) return;
    const key = `${m[1]}-${+m[3]}-${m[2].toLowerCase()}`;
    slugByLabel.set(key, p.slug);
  });

  // KTC only actively prices ~2 draft classes out, not this app's full 4-year
  // window (confirmed live: today's rankings have 2027/2028 pick labels but no
  // 2029 ones at all) — mirrors Vault.buildKtcPickMap's own reasoning for
  // current values: map to the nearest season that's actually priced, for the
  // same round+tier, rather than treating a too-far-out year as worthless.
  const availableSeasons = [...new Set([...slugByLabel.keys()].map(k => +k.split('-')[0]))].sort((a, b) => a - b);
  function nearestAvailableSeason(season) {
    return availableSeasons.reduce((best, y) => Math.abs(y - season) < Math.abs(best - season) ? y : best, availableSeasons[0]);
  }

  const detailTag = isSF ? 'pd-superflex' : 'pd-oneqb';
  const pickValueHistory = new Map(); // labelKey -> Map(date -> value)
  for (const key of neededLabels) {
    const [seasonStr, roundStr, tierWord] = key.split('-');
    const season = +seasonStr;
    let fetchKey = key;
    if (!slugByLabel.has(fetchKey)) {
      const nearest = nearestAvailableSeason(season);
      fetchKey = `${nearest}-${roundStr}-${tierWord}`;
      console.log(`  ${season} ${ROUND_ORD[roundStr]} (${tierWord}) not in today's rankings — using nearest priced season ${nearest} instead.`);
    }
    if (pickValueHistory.has(fetchKey)) { pickValueHistory.set(key, pickValueHistory.get(fetchKey)); continue; }
    const slug = slugByLabel.get(fetchKey);
    if (!slug) { console.log(`  SKIP ${fetchKey} — no priced season available at all for this round/tier.`); continue; }
    await sleep(REQUEST_DELAY_MS);
    const html = await fetch(`${RANKINGS_URL}/players/${slug}`, { headers: HEADERS }).then(r => r.text());
    const detail = extractJsonScriptTag(html, detailTag);
    if (!detail) { console.log(`  FAILED: ${fetchKey}`); continue; }
    const blend = pickBlendHistory(detail, tier);
    const byDate = new Map(blend.map(pt => [parseKtcDate(pt.d), pt.v]));
    pickValueHistory.set(fetchKey, byDate);
    if (fetchKey !== key) pickValueHistory.set(key, byDate);
    console.log(`  ${fetchKey}: ${byDate.size} days`);
  }

  // Ownership-over-time: every pick starts with its original roster, real
  // trades (draft_picks: {season, round, roster_id, owner_id}) move it.
  const pickEvents = [];
  transactions.forEach(t => (t.draft_picks || []).forEach(pk => {
    if (!pickYears.includes(+pk.season)) return;
    pickEvents.push({ date: new Date(t.created), key: `${pk.season}-${pk.round}-${pk.roster_id}`, newOwner: pk.owner_id });
  }));
  pickEvents.sort((a, b) => a.date - b.date);

  // Real current ownership (traded_picks), to check the replay against and to
  // patch around anything the replay can't see.
  const realOwner = new Map(pickAssets.map(a => [`${a.season}-${a.round}-${a.originalRoster}`, a.originalRoster]));
  (tradedPicks || []).filter(p => pickYears.includes(+p.season)).forEach(p => {
    realOwner.set(`${p.season}-${p.round}-${p.roster_id}`, p.owner_id);
  });

  // Dry run: replay every event once, just to see whether the FINAL state
  // matches Sleeper's real current ownership, before computing anything.
  const dryRun = new Map(pickAssets.map(a => [`${a.season}-${a.round}-${a.originalRoster}`, a.originalRoster]));
  pickEvents.forEach(e => { if (dryRun.has(e.key)) dryRun.set(e.key, e.newOwner); });
  const mismatchKeys = [...realOwner.keys()].filter(key => dryRun.get(key) !== realOwner.get(key));

  // A handful of untraceable picks (moved by some admin action with no
  // transaction record at all — confirmed live: 1 of this league's 18 real
  // pick trades has zero matching transaction) is a real gap in what Sleeper's
  // public API exposes, not a bug in this replay — pin those specific picks to
  // their real current owner for the whole period instead of failing outright.
  // A LARGE mismatch count would mean something is actually wrong with the
  // replay logic itself, which still needs to stop and be investigated.
  const MAX_TOLERABLE_UNTRACEABLE = 3;
  if (mismatchKeys.length > MAX_TOLERABLE_UNTRACEABLE) {
    mismatchKeys.forEach(key => console.log(`MISMATCH ${key}: replayed=${dryRun.get(key)} real=${realOwner.get(key)}`));
    throw new Error(`${mismatchKeys.length} picks don't match Sleeper's real current ownership — too many to be isolated admin actions; refusing to write until the replay logic is fixed.`);
  }
  if (mismatchKeys.length > 0) {
    mismatchKeys.forEach(key => console.log(`Untraceable pick move (no transaction record) ${key}: pinning to its real current owner ${realOwner.get(key)} for the whole period.`));
  } else {
    console.log("Self-check passed: reconstructed pick ownership exactly matches Sleeper's real current state.");
  }

  const ownerOf = new Map(pickAssets.map(a => {
    const key = `${a.season}-${a.round}-${a.originalRoster}`;
    return [key, mismatchKeys.includes(key) ? realOwner.get(key) : a.originalRoster];
  }));
  const liveEvents = pickEvents.filter(e => !mismatchKeys.includes(e.key));

  const startDay = Date.UTC(2026, 1, 2); // matches backfill-team-value-history.js's real startup-draft day
  const today = new Date();
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const DAY_MS = 24 * 60 * 60 * 1000;

  const byDayTeamPicksValue = new Map(); // date -> Map(rosterId -> value)
  let eventIdx = 0;
  for (let dayStart = startDay; dayStart <= todayDay; dayStart += DAY_MS) {
    const cursor = new Date(dayStart + DAY_MS - 1);
    while (eventIdx < liveEvents.length && liveEvents[eventIdx].date <= cursor) {
      const e = liveEvents[eventIdx];
      if (ownerOf.has(e.key)) ownerOf.set(e.key, e.newOwner);
      eventIdx++;
    }
    const date = dateStr(new Date(dayStart));
    const perTeam = new Map(rosters.map(r => [r.roster_id, 0]));
    pickAssets.forEach(a => {
      const ownerKey = `${a.season}-${a.round}-${a.originalRoster}`;
      const owner = ownerOf.get(ownerKey);
      const lKey = labelKey(a);
      const hist = pickValueHistory.get(lKey);
      const v = hist ? (hist.get(date) ?? [...hist.values()][0] ?? 0) : 0;
      perTeam.set(owner, (perTeam.get(owner) || 0) + v);
    });
    byDayTeamPicksValue.set(date, perTeam);
  }

  // Final self-check: with the pinned corrections applied, the replay must
  // now match Sleeper's real current ownership exactly.
  let stillMismatched = 0;
  for (const [key, owner] of realOwner.entries()) {
    if (ownerOf.get(key) !== owner) { stillMismatched++; console.log(`STILL MISMATCHED ${key}: replayed=${ownerOf.get(key)} real=${owner}`); }
  }
  if (stillMismatched > 0) throw new Error(`${stillMismatched} pick(s) still don't match after pinning known untraceable moves — refusing to write.`);

  const existing = await readJson(TEAM_HISTORY_PATH);
  let updated = 0;
  existing.snapshots.forEach(s => {
    const perTeam = byDayTeamPicksValue.get(s.date);
    if (!perTeam) return; // outside the replay window (shouldn't happen once merged with the team backfill)
    s.teams.forEach(t => {
      if (t.picksValue != null) return; // real day already has a real picksValue — never overwrite it
      const pv = Math.round(perTeam.get(t.rosterId) || 0);
      t.picksValue = pv;
      if (t.playerValue != null) t.total = t.playerValue + pv;
      updated++;
    });
  });

  await fs.writeFile(TEAM_HISTORY_PATH, JSON.stringify(existing));
  console.log(`Filled in picksValue/total for ${updated} team-days.`);
}

main().catch(e => { console.error(e); process.exit(1); });
