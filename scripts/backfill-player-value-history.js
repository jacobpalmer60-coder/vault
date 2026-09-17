// Proof-of-concept / test harness for backfilling multi-year per-player dynasty
// value history straight from KeepTradeCut's own player profile pages, rather than
// waiting on our own daily snapshot to accumulate it going forward.
//
// KTC's bulk /dynasty-rankings page only carries TODAY's values (what fetch-ktc.js
// already scrapes daily). Each player's own profile page
// (/dynasty-rankings/players/{slug}) embeds a `<script type="application/json"
// id="pd-superflex">` (or "pd-oneqb") data island with the SAME blend/crowd/
// tradesourced values we already use, but as a full daily time series going back
// years — confirmed live: Josh Allen's page carried 2,303 daily points back to
// 2020-05-26. This script fetches a handful of real players, extracts that time
// series, and writes a sample file to inspect before ever attempting a full
// league backfill or deciding how to merge it into team-value-history.json (which
// needs roster-composition-over-time from Sleeper's transactions too — a separate,
// harder problem this script does NOT attempt).
//
// Format-aware: picks the pd-superflex/pd-oneqb tag by the league's actual 1QB/SF
// setting, and the plain/TEP/TEPP variant by its real bonus_rec_te — the first
// version of this script hardcoded Superflex + no-TEP and would have silently
// pulled the wrong series for our own TEP league. See Vault.ktcTepSuffix
// (vault-core.js) for the same logic used everywhere else in the app.
//
// Run manually: node scripts/backfill-player-value-history.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'data', '_backfill-test-sample.json');
const LEAGUE_ID = '1313454100225990656';

// A small, deliberately varied test set — an established veteran, a rookie (edge
// case: should have little/no history before his draft year), a couple of
// established skill players at other positions.
const TEST_PLAYERS = ['Josh Allen', 'Malik Nabers', 'Jeremiyah Love', 'James Cook', 'Trey McBride'];

const RANKINGS_URL = 'https://keeptradecut.com/dynasty-rankings';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
};
const REQUEST_DELAY_MS = 500; // considerate pacing — this hits one page per player, not the bulk endpoint

function extractJsonScriptTag(html, id) {
  const openTag = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>`));
  if (!openTag) return null;
  const start = openTag.index + openTag[0].length;
  const end = html.indexOf('</script>', start);
  if (end === -1) return null;
  return JSON.parse(html.slice(start, end));
}

// Mirrors Vault.ktcTepSuffix — nearest TEP tier rather than an exact bonus_rec_te match.
function ktcTepTier(bonusRecTe) {
  const b = +bonusRecTe || 0;
  if (b < 0.25) return 'plain';
  if (b < 0.75) return 'tep';
  return 'tepp';
}

// The base player-detail object exposes the plain (no-TEP) history under
// overallValue/vftValueHistory/blendValueHistory; the tep/tepp sub-objects use
// different field names (history/vftHistory/blendHistory) for the same series.
function historyFieldsFor(tier) {
  return tier === 'plain'
    ? { crowd: 'overallValue', vft: 'vftValueHistory', blend: 'blendValueHistory' }
    : { crowd: 'history', vft: 'vftHistory', blend: 'blendHistory' };
}

// TEP/TEPP only change a TE's own value — confirmed live against today's values
// (superflexValues.tep.blendValue === superflexValues.blendValue for a QB/RB/WR,
// but genuinely higher for a TE) — so KTC only bothers storing a distinct
// tep/tepp HISTORICAL series for actual TEs; every other position's tep/tepp
// history arrays come back empty even though their current-value fields don't.
// Falls back to the plain series in that case, since it's the same number anyway.
function pickHistory(detail, tier) {
  const fields = historyFieldsFor(tier);
  const source = tier === 'plain' ? detail : (detail[tier] || {});
  if (tier !== 'plain' && !(source[fields.blend] || []).length) {
    const plainFields = historyFieldsFor('plain');
    return { crowd: detail[plainFields.crowd] || [], vft: detail[plainFields.vft] || [], blend: detail[plainFields.blend] || [] };
  }
  return { crowd: source[fields.crowd] || [], vft: source[fields.vft] || [], blend: source[fields.blend] || [] };
}

// KTC's history dates are "YYMMDD" strings (e.g. "260917" = 2026-09-17).
function parseKtcDate(d) {
  const yy = +d.slice(0, 2), mm = d.slice(2, 4), dd = d.slice(4, 6);
  const yyyy = yy < 70 ? 2000 + yy : 1900 + yy; // matches 2020s data comfortably
  return `${yyyy}-${mm}-${dd}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Checking league format/scoring settings...');
  const league = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`).then(r => r.json());
  const isSF = (league.roster_positions || []).includes('SUPER_FLEX');
  const tier = ktcTepTier(league.scoring_settings?.bonus_rec_te);
  const detailTag = isSF ? 'pd-superflex' : 'pd-oneqb';
  console.log(`  -> ${isSF ? 'Superflex' : '1QB'}, TEP tier: ${tier} (bonus_rec_te=${league.scoring_settings?.bonus_rec_te})`);

  console.log(`Fetching bulk rankings page for name -> slug lookup...`);
  const rankingsHtml = await fetch(RANKINGS_URL, { headers: HEADERS }).then(r => r.text());
  const allPlayers = extractJsonScriptTag(rankingsHtml, 'ktc-players');
  if (!allPlayers) throw new Error('Could not find ktc-players data on rankings page — page shape may have changed.');

  const results = [];
  for (const name of TEST_PLAYERS) {
    const match = allPlayers.find(p => p.playerName === name);
    if (!match) { console.log(`  SKIP "${name}" — not found in today's rankings.`); continue; }

    console.log(`Fetching profile for ${name} (slug: ${match.slug})...`);
    await sleep(REQUEST_DELAY_MS);
    const url = `${RANKINGS_URL}/players/${match.slug}`;
    const html = await fetch(url, { headers: HEADERS }).then(r => r.text());
    const detail = extractJsonScriptTag(html, detailTag);
    if (!detail) { console.log(`  FAILED to find ${detailTag} data for ${name}`); continue; }

    const raw = pickHistory(detail, tier);
    const blend = raw.blend.map(pt => ({ date: parseKtcDate(pt.d), value: pt.v }));
    const crowd = raw.crowd.map(pt => ({ date: parseKtcDate(pt.d), value: pt.v }));
    const vft = raw.vft.map(pt => ({ date: parseKtcDate(pt.d), value: pt.v }));

    results.push({
      name,
      slug: match.slug,
      ktcId: match.playerID,
      format: { isSF, tier },
      pointCounts: { blend: blend.length, crowd: crowd.length, vft: vft.length },
      blendFirst3: blend.slice(0, 3),
      blendLast3: blend.slice(-3),
    });
    console.log(`  -> ${blend.length} blend-value days, ${blend[0]?.date} to ${blend[blend.length - 1]?.date}`);
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} players' sample history to ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
