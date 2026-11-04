// Cloudflare Worker: asks Roster Audit's trade calculator for its verdict, so
// the Trade Calculator can show it without the API key being in the page. The
// key lives in the Worker's settings as the secret RA_KEY, never in this file.
//
// Takes { side_a, side_b, is_superflex, is_te_premium }. Only those fields are sent on, so this
// can't be used to reach anything else on their API. Their limit is 100 trades an
// hour per key: repeat trades are answered from memory, and when the limit is hit
// the page keeps its plain read of their values.
const ALLOWED_ORIGINS = ['https://jacobpalmer60-coder.github.io', 'http://localhost:5191'];
const RA_URL = 'https://rosteraudit.com/wp-json/ra/v1/trade/calculate';
const MAX_PIECES = 15, MEMO_HOURS = 6, MEMO_SIZE = 500;
const memo = new Map();

const cleanAsset = a => {
  if (a?.type === 'player' && /^\d+$/.test(a.id)) return { type: 'player', id: a.id };
  if (a?.type === 'pick' && Number.isInteger(a.season) && a.round >= 1 && a.round <= 5 && ['early', 'mid', 'late'].includes(a.slot)) {
    return { type: 'pick', season: a.season, round: a.round, slot: a.slot };
  }
  return null;
};
const cleanSide = side => {
  if (!Array.isArray(side) || !side.length || side.length > MAX_PIECES) return null;
  const list = side.map(cleanAsset);
  return list.every(Boolean) ? list : null;
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Not allowed', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'POST only' }, 405);

    const input = await request.json().catch(() => null);
    const side_a = cleanSide(input?.side_a), side_b = cleanSide(input?.side_b);
    if (!side_a || !side_b) return reply({ error: 'Bad trade' }, 400);
    const body = JSON.stringify({ side_a, side_b, settings: { is_superflex: !!input.is_superflex, is_te_premium: !!input.is_te_premium } });

    const saved = memo.get(body);
    if (saved && Date.now() - saved.at < MEMO_HOURS * 3600000) return reply(saved.data);

    const res = await fetch(RA_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'TheVault/1.0 (dynasty trade calculator)', 'X-RA-Key': env.RA_KEY }, body });
    if (!res.ok) return reply({ unavailable: true, limited: res.status === 429, status: res.status });
    const data = await res.json();
    if (memo.size >= MEMO_SIZE) memo.clear();
    memo.set(body, { at: Date.now(), data });
    return reply(data);
  }
};
