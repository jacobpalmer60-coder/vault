// FantasyPros API check: which dynasty consensus-ranking variants the key can
// reach (1QB vs superflex, scoring), and which rank fields come back. Reads the
// key from FANTASYPROS_API_KEY and never prints it. Run by the
// fantasypros-probe workflow (results in data/fp-probe.txt), or locally:
//   PowerShell:  $env:FANTASYPROS_API_KEY = "<your key>"; node scripts/fp-probe.mjs
const key = process.env.FANTASYPROS_API_KEY;
if (!key) { console.error('Set FANTASYPROS_API_KEY first (see the top of this file).'); process.exit(1); }

const Y = new Date().getFullYear();
const BASE = 'https://api.fantasypros.com/public/v2/json';
// Superflex lists put QBs near the top; the top 8 of each variant shows which is which.
const VARIANTS = [
  `nfl/${Y}/consensus-rankings?type=dynasty&position=ALL&scoring=PPR`,
  `nfl/${Y}/consensus-rankings?type=dynasty&position=OP&scoring=PPR`,
  `nfl/${Y}/consensus-rankings?type=dynasty&position=SF&scoring=PPR`,
  `nfl/${Y}/consensus-rankings?type=dynasty-superflex&position=ALL&scoring=PPR`,
  `nfl/${Y}/consensus-rankings?type=dynasty-sf&position=ALL&scoring=PPR`,
  `nfl/${Y}/consensus-rankings?type=dynasty&position=ALL&scoring=HALF`,
  `nfl/${Y}/consensus-rankings?type=dynasty&position=QB&scoring=PPR`,
  `nfl/${Y}/consensus-rankings?type=dynasty-rookies&position=ALL&scoring=PPR`,
];

const wait = ms => new Promise(r => setTimeout(r, ms)); // Premium: 1 request/second
let shownFields = false;
for (const p of VARIANTS) {
  await wait(1100);
  try {
    const r = await fetch(`${BASE}/${p}`, { headers: { 'x-api-key': key } });
    const text = await r.text();
    if (!r.ok) { console.log(`${r.status}  ${p}\n      ${text.replace(/\s+/g, ' ').slice(0, 160)}`); continue; }
    const j = JSON.parse(text);
    const ps = j.players || [];
    console.log(`${r.status}  ${p}\n      ranking: ${j.ranking_type_name || '?'} · experts: ${j.total_experts ?? '?'} · players: ${ps.length} · updated: ${j.last_updated || '?'}`);
    console.log('      top 8: ' + ps.slice(0, 8).map(x => `${x.player_name} (${x.player_position_id}) ${x.rank_ecr ?? '?'}`).join(' | '));
    const qb = ps.find(x => x.player_position_id === 'QB');
    if (qb) console.log(`      first QB: ${qb.player_name} at ${qb.rank_ecr}`);
    if (!shownFields && ps[0]) {
      shownFields = true;
      const f = Object.fromEntries(Object.entries(ps[0]).filter(([k]) => /rank|tier|pos|age|team|sportsdata|yahoo|player_id|name/.test(k)));
      console.log('      rank fields (first player): ' + JSON.stringify(f));
    }
  } catch (e) {
    console.log(`ERR  ${p} — ${e.message}`);
  }
}
