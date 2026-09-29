// Fetches FantasyPros' dynasty expert consensus rankings (1QB and superflex)
// and writes data/fp-dynasty.json, the "Experts" read in the Trade Calculator
// (Vault.buildExpertView). Shown with FantasyPros' permission, credited on
// the page.
//
// Needs the FANTASYPROS_API_KEY repo secret. The Premium plan allows 1
// request/second and 500/day; this makes 2. If the key is missing or a request
// fails, the existing file is kept and the daily job carries on.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'fp-dynasty.json');
const BASE = 'https://api.fantasypros.com/public/v2/json';
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const key = process.env.FANTASYPROS_API_KEY;

async function rankings(position) {
  const url = `${BASE}/nfl/${new Date().getFullYear()}/consensus-rankings?type=dynasty&position=${position}&scoring=PPR`;
  const r = await fetch(url, { headers: { 'x-api-key': key } });
  if (!r.ok) throw new Error(`${position}: HTTP ${r.status}`);
  return r.json();
}

// Only what the site uses: who, where, and how the experts rank them.
const slim = p => ({
  name: p.player_name,
  pos: p.player_position_id,
  team: p.player_team_id,
  ecr: p.rank_ecr,
  best: Number(p.rank_min),
  worst: Number(p.rank_max),
  posRank: p.pos_rank,
  tier: p.tier
});

async function main() {
  if (!key) { console.log('No FANTASYPROS_API_KEY; keeping the existing data/fp-dynasty.json.'); return; }
  try {
    const oneQb = await rankings('ALL');
    await new Promise(r => setTimeout(r, 1100));   // 1 request/second
    const superflex = await rankings('OP');         // OP = superflex: QBs ranked with everyone
    const keep = j => (j.players || []).filter(p => SKILL.has(p.player_position_id)).map(slim);
    const out = {
      source: 'FantasyPros dynasty expert consensus rankings',
      url: 'https://www.fantasypros.com/nfl/rankings/dynasty-overall.php',
      updated: oneQb.last_updated || null,
      fetched: new Date().toISOString(),
      experts: oneQb.total_experts ?? null,
      oneQb: keep(oneQb),
      superflex: keep(superflex)
    };
    if (!out.oneQb.length || !out.superflex.length) throw new Error('empty rankings');
    await fs.writeFile(OUT, JSON.stringify(out));
    console.log(`Wrote ${OUT}: ${out.oneQb.length} 1QB, ${out.superflex.length} superflex, ${out.experts} experts, updated ${out.updated}.`);
  } catch (e) {
    console.log(`FantasyPros fetch failed (${e.message}); keeping the existing data/fp-dynasty.json.`);
  }
}
main();
