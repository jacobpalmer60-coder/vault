// Daily snapshot of REAL, UNIVERSAL (not league-specific) KTC price history for
// every player and pick KTC currently ranks, so any league's League Overview and
// Player Rankings pages can chart trends over time — not just the one league this
// tool originally tracked. A league's own dynasty roster/pick-ownership history is
// reconstructed live, client-side, from Sleeper (see Vault.buildTeamValueHistory in
// vault-core.js); this script only maintains the two shared price-history references
// that any league's reconstruction reads from.
//
// Self-extending: today's row for every ALREADY-tracked player/pick is just copied
// straight out of data/ktc-values.json (already fetched by fetch-ktc.js this same
// run — no extra request). Any player/pick that's NEVER been seen before (a rookie
// gaining relevance, a new pick-year label rolling in) triggers a one-time deep
// scrape of their KTC profile page, which carries that asset's FULL historical price
// series (confirmed live: individual player/pick pages go back years further than
// this daily snapshot could accumulate on its own) — merged into every past date the
// files already cover, not just appended going forward.
//
// Runs as part of the same daily Action as the other data refreshes — one snapshot
// per calendar day (a manual re-run same day replaces, not duplicates).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const KTC_PATH = path.join(DATA_DIR, 'ktc-values.json');
const PROJ_PATH = path.join(DATA_DIR, 'projections.json');
const PLAYER_HISTORY_PATH = path.join(DATA_DIR, 'player-value-history.json');
const PICK_HISTORY_PATH = path.join(DATA_DIR, 'pick-value-history.json');

// Bounds file growth (see original sizing note this replaces): trims the OLDEST
// day once history exceeds this many snapshots. Picks are far fewer distinct
// assets than players, so its file stays tiny regardless — no separate cap needed.
const MAX_PLAYER_SNAPSHOTS = 3650;

const RANKINGS_URL = 'https://keeptradecut.com/dynasty-rankings';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
};
const REQUEST_DELAY_MS = 500; // considerate pacing — one page per new asset

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

function extractJsonScriptTag(html, id) {
  const openTag = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>`));
  if (!openTag) return null;
  const start = openTag.index + openTag[0].length;
  const end = html.indexOf('</script>', start);
  if (end === -1) return null;
  return JSON.parse(html.slice(start, end));
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

// The league (and the humans reading this graph) live in US Mountain time, not UTC
// — using the UTC calendar date meant anything run after ~6pm Mountain landed on
// "tomorrow" even though it was still today locally. America/Denver auto-handles
// the MDT/MST switch, so this stays correct year-round without tracking DST here.
function mountainDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Pulls BOTH format variants (Superflex and 1QB) and, when requested, both TEP
// tiers, from ONE already-fetched profile page — KTC embeds both as separate JSON
// data islands (pd-superflex / pd-oneqb) on every player's and pick's page, so this
// costs no extra requests regardless of which league format eventually reads it.
// Returns Map<date, {sf, oneQB, sf_tep?, sf_tepp?, oneQB_tep?, oneQB_tepp?}>.
function buildDateMap(html, includeTep) {
  const byDate = new Map();
  function apply(tagId, prefix) {
    const detail = extractJsonScriptTag(html, tagId);
    if (!detail) return;
    (detail.blendValueHistory || []).forEach(pt => {
      const date = parseKtcDate(pt.d);
      if (!byDate.has(date)) byDate.set(date, {});
      byDate.get(date)[prefix] = pt.v;
    });
    if (!includeTep) return;
    ['tep', 'tepp'].forEach(tier => {
      ((detail[tier] || {}).blendHistory || []).forEach(pt => {
        const date = parseKtcDate(pt.d);
        if (!byDate.has(date)) byDate.set(date, {});
        byDate.get(date)[`${prefix}_${tier}`] = pt.v;
      });
    });
  }
  apply('pd-superflex', 'sf');
  apply('pd-oneqb', 'oneQB');
  return byDate;
}

// Merges a newly-scraped asset's date map into every date the history file already
// spans (or extends it further back) — NOT just appended forward — since a
// never-before-seen asset can still have real KTC history reaching back through
// dates other assets are already tracked for.
function mergeAssetHistory(history, listKey, key, dateMap, skipDate) {
  const byDate = new Map(history.snapshots.map(s => [s.date, s]));
  dateMap.forEach((fields, date) => {
    if (date === skipDate) return; // today is written separately, straight from ktc-values.json
    let snap = byDate.get(date);
    if (!snap) {
      snap = { date, [listKey]: {} };
      history.snapshots.push(snap);
      byDate.set(date, snap);
    }
    if (!snap[listKey]) snap[listKey] = {};
    snap[listKey][key] = fields;
  });
}

async function main() {
  const today = mountainDateString();

  const ktcData = await readJson(KTC_PATH, null);
  const projData = await readJson(PROJ_PATH, null);
  if (!ktcData) throw new Error('data/ktc-values.json missing — run fetch-ktc.js first.');
  if (!projData) throw new Error('data/projections.json missing — run fetch-projections.js first.');

  const playerHistory = await readJson(PLAYER_HISTORY_PATH, { snapshots: [] });
  const pickHistory = await readJson(PICK_HISTORY_PATH, { snapshots: [] });

  // Same-day re-run (e.g. manual dispatch) replaces today's row, not duplicates.
  [playerHistory, pickHistory].forEach(h => {
    if (h.snapshots.length && h.snapshots[h.snapshots.length - 1].date === today) h.snapshots.pop();
  });

  const seenPlayerKeys = new Set();
  playerHistory.snapshots.forEach(s => Object.keys(s.players || {}).forEach(k => seenPlayerKeys.add(k)));
  const seenPickKeys = new Set();
  pickHistory.snapshots.forEach(s => Object.keys(s.picks || {}).forEach(k => seenPickKeys.add(k)));

  // Raw projected stats (not pre-scored) keyed by normalized name, so any league
  // can score this player's projected PPG trend to its OWN scoring settings later
  // — mirrors Vault.buildProjectedPpgMapByName's join, just kept raw instead of
  // dot-producted against one particular league's weights.
  const statsByName = new Map();
  Object.values(projData.players || {}).forEach(p => {
    const key = normalizeName(p.name);
    if (key && p.stats?.gp) statsByName.set(key, p.stats);
  });

  const todayPlayers = {};
  const newPlayers = [];
  (ktcData.players || []).forEach(p => {
    const key = normalizeName(p.name);
    if (!key) return;
    const entry = { sf: p.sf, oneQB: p.oneQB };
    if (p.pos === 'TE') { entry.sf_tep = p.sf_tep; entry.sf_tepp = p.sf_tepp; entry.oneQB_tep = p.oneQB_tep; entry.oneQB_tepp = p.oneQB_tepp; }
    const stats = statsByName.get(key);
    if (stats) entry.stats = stats;
    todayPlayers[key] = entry;
    if (!seenPlayerKeys.has(key)) newPlayers.push({ key, name: p.name });
  });

  const todayPicks = {};
  const newPicks = [];
  (ktcData.picks || []).forEach(p => {
    const key = `${p.season}-${p.round}-${p.slot}`;
    todayPicks[key] = { sf: p.sf, oneQB: p.oneQB, sf_tep: p.sf_tep, sf_tepp: p.sf_tepp, oneQB_tep: p.oneQB_tep, oneQB_tepp: p.oneQB_tepp };
    if (!seenPickKeys.has(key)) newPicks.push({ key, season: p.season, round: p.round, slot: p.slot });
  });

  console.log(`Today (${today}): ${Object.keys(todayPlayers).length} players, ${Object.keys(todayPicks).length} picks tracked. ${newPlayers.length} new player(s), ${newPicks.length} new pick label(s) need historical backfill.`);

  if (newPlayers.length || newPicks.length) {
    console.log('Fetching bulk rankings page for slug lookup...');
    const rankingsHtml = await fetch(RANKINGS_URL, { headers: HEADERS }).then(r => r.text());
    const allEntries = extractJsonScriptTag(rankingsHtml, 'ktc-players');
    if (!allEntries) throw new Error('Could not find ktc-players data on rankings page — page shape may have changed.');
    const pickNamePattern = /^(\d{4})\s+(Early|Mid|Late)\s+(\d+)(?:st|nd|rd|th)$/i;
    const slugByPlayerName = new Map();
    const slugByPickLabel = new Map();
    allEntries.forEach(p => {
      if (p.position === 'RDP') {
        const m = p.playerName.match(pickNamePattern);
        if (m) slugByPickLabel.set(`${m[1]}-${+m[3]}-${m[2].toLowerCase()}`, p.slug);
      } else {
        const key = normalizeName(p.playerName);
        if (key) slugByPlayerName.set(key, p.slug);
      }
    });

    let ok = 0, skipped = 0, failed = 0;
    for (const { key, name } of newPlayers) {
      const slug = slugByPlayerName.get(key);
      if (!slug) { skipped++; continue; }
      await sleep(REQUEST_DELAY_MS);
      try {
        const html = await fetch(`${RANKINGS_URL}/players/${slug}`, { headers: HEADERS }).then(r => r.text());
        const isTE = (ktcData.players.find(p => normalizeName(p.name) === key) || {}).pos === 'TE';
        const dateMap = buildDateMap(html, isTE);
        mergeAssetHistory(playerHistory, 'players', key, dateMap, today);
        ok++;
      } catch (e) { failed++; console.log(`  ERROR fetching player ${name}: ${e.message}`); }
    }
    if (newPlayers.length) console.log(`Backfilled ${ok} new players (${skipped} not found on rankings page, ${failed} failed).`);

    let pOk = 0, pFailed = 0;
    for (const { key, season, round, slot } of newPicks) {
      const slug = slugByPickLabel.get(key);
      if (!slug) { console.log(`  SKIP pick ${key} — not found on today's rankings page.`); continue; }
      await sleep(REQUEST_DELAY_MS);
      try {
        const html = await fetch(`${RANKINGS_URL}/players/${slug}`, { headers: HEADERS }).then(r => r.text());
        const dateMap = buildDateMap(html, true);
        mergeAssetHistory(pickHistory, 'picks', key, dateMap, today);
        pOk++;
      } catch (e) { pFailed++; console.log(`  ERROR fetching pick ${season} ${slot} ${round}: ${e.message}`); }
    }
    if (newPicks.length) console.log(`Backfilled ${pOk} new pick labels (${pFailed} failed).`);
  }

  playerHistory.snapshots.push({ date: today, players: todayPlayers });
  pickHistory.snapshots.push({ date: today, picks: todayPicks });
  playerHistory.snapshots.sort((a, b) => a.date < b.date ? -1 : 1);
  pickHistory.snapshots.sort((a, b) => a.date < b.date ? -1 : 1);

  if (playerHistory.snapshots.length > MAX_PLAYER_SNAPSHOTS) playerHistory.snapshots = playerHistory.snapshots.slice(-MAX_PLAYER_SNAPSHOTS);

  await fs.writeFile(PLAYER_HISTORY_PATH, JSON.stringify(playerHistory));
  await fs.writeFile(PICK_HISTORY_PATH, JSON.stringify(pickHistory));
  console.log(`Wrote ${playerHistory.snapshots.length} player-history days, ${pickHistory.snapshots.length} pick-history days.`);
}

main().catch(e => { console.error(e); process.exit(1); });
