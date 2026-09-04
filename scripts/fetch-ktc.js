// Scrapes KeepTradeCut's dynasty rankings page and writes data/ktc-values.json.
// KTC has no public API — the full player list ships as an inline `var playersArray = [...]`
// in the page HTML. Run server-side (GitHub Actions) since keeptradecut.com sends no
// CORS headers, so this can't be fetched from a browser running on another origin.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE_URL = 'https://keeptradecut.com/dynasty-rankings';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractArray(html, varName) {
  const marker = `var ${varName} = `;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`Could not find "${varName}" in page HTML`);
  const arrStart = start + marker.length;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = arrStart; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '[') depth++;
    if (c === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`Could not find end of "${varName}" array`);
  return JSON.parse(html.slice(arrStart, end));
}

async function main() {
  const res = await fetch(PAGE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const players = extractArray(html, 'playersArray');

  const out = players
    .filter(p => p.position !== 'RDP') // rookie draft picks — not in scope yet
    .map(p => ({
      name: p.playerName,
      pos: p.position,
      team: p.team || '',
      age: p.age || null,
      rookie: !!p.rookie,
      oneQB: p.oneQBValues.value,
      oneQB_tep: p.oneQBValues.tep.value,
      oneQB_tepp: p.oneQBValues.tepp.value,
      sf: p.superflexValues.value,
      sf_tep: p.superflexValues.tep.value,
      sf_tepp: p.superflexValues.tepp.value
    }));

  if (out.length < 300) {
    throw new Error(`Only got ${out.length} players — page shape probably changed, refusing to overwrite`);
  }

  const payload = {
    source: 'keeptradecut.com/dynasty-rankings',
    updated: new Date().toISOString(),
    count: out.length,
    players: out
  };

  const outPath = path.join(__dirname, '..', 'data', 'ktc-values.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote ${out.length} players to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
