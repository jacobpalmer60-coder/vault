// Scrapes KeepTradeCut's dynasty rankings page and writes data/ktc-values.json.
// KTC has no public API — the full player list ships as a JSON data island,
// `<script type="application/json" id="ktc-players">[...]</script>`, in the page
// HTML. Run server-side (GitHub Actions) since keeptradecut.com sends no CORS
// headers, so this can't be fetched from a browser running on another origin.
//
// Used to ship as a literal `var playersArray = [...]` assignment instead — KTC
// switched it to `var playersArray = JSON.parse(document.getElementById(
// 'ktc-players').textContent)` at some point between 2026-09-07 and 2026-09-08
// (confirmed via the Action's run history: every scheduled run failed starting
// 09-08, silently skipping the daily value snapshot for two days since this was
// the very first step). The bracket-counting extractor below was built for the
// old literal-array shape and just found the text "JSON.parse(...)" where it
// expected `[`, so it always failed at the `JSON.parse(html.slice(...))` call.
// The tags/rounds/tiers KTC exposes (early/mid/late per round, for the pick
// naming regex below) didn't change, just the data's containing element — no
// other part of this script needed touching once the extraction match itself
// pulls from the right place.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE_URL = 'https://keeptradecut.com/dynasty-rankings';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractJsonScriptTag(html, id) {
  const openTag = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>`));
  if (!openTag) throw new Error(`Could not find <script id="${id}"> in page HTML`);
  const start = openTag.index + openTag[0].length;
  const end = html.indexOf('</script>', start);
  if (end === -1) throw new Error(`Could not find closing </script> for id="${id}"`);
  return JSON.parse(html.slice(start, end));
}

async function main() {
  const res = await fetch(PAGE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const all = extractJsonScriptTag(html, 'ktc-players');

  // KTC now lists BOTH a generic per-tier pick ("2027 Early 1st") and, for the
  // current season specifically, one entry per exact draft slot ("2026 Pick
  // 1.01") — the exact-slot ones don't match this pattern and are skipped
  // below, same as any other unrecognized name; we only ever wanted the
  // early/mid/late tier a pick falls in (see Vault.ktcPickSlot), not its exact
  // numbered slot, so losing nothing by ignoring the new format.
  const pickNamePattern = /^(\d{4})\s+(Early|Mid|Late)\s+(\d+)(?:st|nd|rd|th)$/i;

  const players = [];
  const picks = [];
  for (const p of all) {
    const row = {
      oneQB: p.oneQBValues.value,
      oneQB_tep: p.oneQBValues.tep.value,
      oneQB_tepp: p.oneQBValues.tepp.value,
      sf: p.superflexValues.value,
      sf_tep: p.superflexValues.tep.value,
      sf_tepp: p.superflexValues.tepp.value
    };
    if (p.position === 'RDP') {
      const m = p.playerName.match(pickNamePattern);
      if (!m) continue; // unrecognized pick name format — skip rather than guess
      picks.push({ season: +m[1], slot: m[2].toLowerCase(), round: +m[3], ktcId: p.playerID, ...row });
    } else {
      players.push({ name: p.playerName, ktcId: p.playerID, pos: p.position, team: p.team || '', age: p.age || null, rookie: !!p.rookie, ...row });
    }
  }

  if (players.length < 300) {
    throw new Error(`Only got ${players.length} players — page shape probably changed, refusing to overwrite`);
  }
  if (picks.length < 20) {
    throw new Error(`Only got ${picks.length} draft picks — page shape probably changed, refusing to overwrite`);
  }

  const payload = {
    source: 'keeptradecut.com/dynasty-rankings',
    updated: new Date().toISOString(),
    count: players.length,
    players,
    picks
  };

  const outPath = path.join(__dirname, '..', 'data', 'ktc-values.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote ${players.length} players and ${picks.length} picks to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
