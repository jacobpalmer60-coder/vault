// Backfills real, multi-year daily dynasty value history for every player
// currently rostered in the tracked league, straight from KeepTradeCut's own
// player profile pages — confirmed live: these embed a full daily time series
// per player (Josh Allen's page carried 2,303 days back to 2020-05-26), far more
// than our own daily snapshot (scripts/snapshot-value-history.js) has had time to
// accumulate on its own.
//
// Format-aware exactly like Vault.ktcTepSuffix (vault-core.js): picks the
// pd-superflex/pd-oneqb tag by the league's real 1QB/SF setting, and the
// plain/TEP/TEPP variant by its real bonus_rec_te — falling back to the plain
// history when a TEP/TEPP series comes back empty, which KTC does for every
// position except TE (confirmed live: TEP/TEPP only ever changes a TE's price).
//
// Merges into data/player-value-history.json in the EXACT same
// { date, players: { normalizedName: { value } } } shape the daily snapshot
// already writes, so player_rankings.html's existing chart code needs no
// changes at all. Only fills in dates BEFORE our own tracking started — the
// daily snapshot stays authoritative for any date it already covers, since
// that pipeline is independently validated against the live roster.
//
// Does NOT attempt to backfill team-value-history.json (League Overview's
// trend chart) — that needs roster-composition-over-time from Sleeper's
// transaction log to know who owned what on a past date, a separate, harder
// problem this script doesn't solve. This only backfills each player's OWN
// value over time, which doesn't depend on who owned them.
//
// Run manually: node scripts/backfill-player-value-history.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LEAGUE_ID = '1313454100225990656';
const PLAYER_HISTORY_PATH = path.join(DATA_DIR, 'player-value-history.json');

const RANKINGS_URL = 'https://keeptradecut.com/dynasty-rankings';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
};
const REQUEST_DELAY_MS = 500; // considerate pacing — one page per player, ~330 requests

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

function extractJsonScriptTag(html, id) {
  const openTag = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>`));
  if (!openTag) return null;
  const start = openTag.index + openTag[0].length;
  const end = html.indexOf('</script>', start);
  if (end === -1) return null;
  return JSON.parse(html.slice(start, end));
}

// Mirrors Vault.ktcTepSuffix.
function ktcTepTier(bonusRecTe) {
  const b = +bonusRecTe || 0;
  if (b < 0.25) return 'plain';
  if (b < 0.75) return 'tep';
  return 'tepp';
}

function historyFieldsFor(tier) {
  return tier === 'plain'
    ? { blend: 'blendValueHistory' }
    : { blend: 'blendHistory' };
}

// See module comment — TEP/TEPP historical series only exist for TEs.
function pickBlendHistory(detail, tier) {
  const fields = historyFieldsFor(tier);
  const source = tier === 'plain' ? detail : (detail[tier] || {});
  const blend = source[fields.blend] || [];
  if (blend.length || tier === 'plain') return blend;
  return detail[historyFieldsFor('plain').blend] || [];
}

// KTC's history dates are "YYMMDD" strings (e.g. "260917" = 2026-09-17).
function parseKtcDate(d) {
  const yy = +d.slice(0, 2), mm = d.slice(2, 4), dd = d.slice(4, 6);
  const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function main() {
  console.log('Fetching league roster + settings...');
  const [league, rosters, sleeperPlayers] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
    fetch('https://api.sleeper.app/v1/players/nfl').then(r => r.json())
  ]);
  const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
  const tier = ktcTepTier(league.scoring_settings?.bonus_rec_te);
  const detailTag = isSF ? 'pd-superflex' : 'pd-oneqb';
  console.log(`  -> ${isSF ? 'Superflex' : '1QB'}, TEP tier: ${tier}`);

  const rosteredIds = new Set(rosters.flatMap(r => r.players || []));
  const rosteredNames = [...rosteredIds]
    .map(pid => sleeperPlayers[String(pid)])
    .filter(Boolean)
    .map(p => `${p.first_name || ''} ${p.last_name || ''}`.trim())
    .filter(Boolean);
  console.log(`  -> ${rosteredNames.length} rostered players to backfill`);

  console.log('Fetching bulk rankings page for name -> slug lookup...');
  const rankingsHtml = await fetch(RANKINGS_URL, { headers: HEADERS }).then(r => r.text());
  const allPlayers = extractJsonScriptTag(rankingsHtml, 'ktc-players');
  if (!allPlayers) throw new Error('Could not find ktc-players data on rankings page — page shape may have changed.');
  // Normalized, not exact-string — Sleeper's first_name+last_name drops suffixes
  // (Jr./III/etc.) that KTC's playerName keeps, so an exact match silently missed
  // real rostered players like DJ Moore, Marvin Harrison Jr., Odell Beckham Jr.
  const bySlugName = new Map(allPlayers.map(p => [normalizeName(p.playerName), p]));

  // date -> { normalizedName: { value } }
  const byDate = new Map();
  let ok = 0, skipped = 0, failed = 0;

  for (const name of rosteredNames) {
    const key = normalizeName(name);
    const match = bySlugName.get(key);
    if (!match) { skipped++; continue; }

    await sleep(REQUEST_DELAY_MS);
    try {
      const url = `${RANKINGS_URL}/players/${match.slug}`;
      const html = await fetch(url, { headers: HEADERS }).then(r => r.text());
      const detail = extractJsonScriptTag(html, detailTag);
      if (!detail) { failed++; console.log(`  FAILED (no ${detailTag} data): ${name}`); continue; }

      const blend = pickBlendHistory(detail, tier);
      blend.forEach(pt => {
        const date = parseKtcDate(pt.d);
        if (!byDate.has(date)) byDate.set(date, {});
        byDate.get(date)[key] = { value: pt.v };
      });
      ok++;
      if (ok % 25 === 0) console.log(`  ...${ok}/${rosteredNames.length} done`);
    } catch (e) {
      failed++;
      console.log(`  ERROR fetching ${name}: ${e.message}`);
    }
  }
  console.log(`Fetched ${ok} players (${skipped} not found in today's rankings, ${failed} failed).`);

  const existing = await readJson(PLAYER_HISTORY_PATH, { leagueId: LEAGUE_ID, snapshots: [] });
  const existingDates = new Set(existing.snapshots.map(s => s.date));

  // Only add dates our own daily snapshot doesn't already cover — that pipeline
  // stays authoritative for anything it's actually recorded.
  const backfillSnapshots = [...byDate.entries()]
    .filter(([date]) => !existingDates.has(date))
    .map(([date, players]) => ({ date, players }));

  const merged = {
    ...existing,
    snapshots: [...backfillSnapshots, ...existing.snapshots].sort((a, b) => a.date < b.date ? -1 : 1)
  };

  await fs.writeFile(PLAYER_HISTORY_PATH, JSON.stringify(merged));
  console.log(`Added ${backfillSnapshots.length} backfilled days (${existing.snapshots.length} existing days kept as-is).`);
  console.log(`New range: ${merged.snapshots[0]?.date} to ${merged.snapshots[merged.snapshots.length - 1]?.date}, ${merged.snapshots.length} total days.`);
}

main().catch(e => { console.error(e); process.exit(1); });
