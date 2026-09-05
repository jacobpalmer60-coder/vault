// Scrapes KeepTradeCut's real dynasty trade database and writes data/ktc-trades.json.
// The page's own JS (site.min.js) shows it POSTs this endpoint with an EMPTY body and
// filters entirely client-side — there's no server-side filter/pagination to reverse-
// engineer, one call already returns the full rolling window (~25k trades, last ~8
// days) of real trades across every format. We do the same "fetch everything, filter
// later" — but filter by the loaded league's settings client-side in trade_database.html
// instead, using this file as the source of truth. Same CORS constraint as fetch-ktc.js:
// keeptradecut.com sends no CORS headers, so this can't run from a browser on another origin.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://keeptradecut.com/dynasty/trade-database/trades';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Origin': 'https://keeptradecut.com',
      'Referer': 'https://keeptradecut.com/dynasty/trade-database',
      'Accept': 'application/json'
    },
    body: '{}'
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const all = await res.json();

  if (all.length < 5000) {
    throw new Error(`Only got ${all.length} trades — endpoint shape probably changed, refusing to overwrite`);
  }

  // Trim to exactly what trade_database.html needs — the full response carries a lot
  // of per-trade metadata (place, dynastyPlatformType, leagueUrl, rostersPerPlayer...)
  // that's irrelevant to matching/rendering, and roughly quarters the file size.
  const trades = all.map(t => ({
    id: t.id,
    date: t.date,
    t1: t.teamOne.playerIds,
    t2: t.teamTwo.playerIds,
    teams: t.settings.teams,
    qbs: t.settings.qBs,
    ppr: t.settings.ppr,
    tep: t.settings.tep,
    starters: +(t.settings.leagueStartingLineup?.count) || 0
  }));

  const payload = {
    source: 'keeptradecut.com/dynasty/trade-database',
    updated: new Date().toISOString(),
    count: trades.length,
    trades
  };

  const outPath = path.join(__dirname, '..', 'data', 'ktc-trades.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote ${trades.length} trades to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
