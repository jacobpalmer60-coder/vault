// One-off check: which FantasyPros API endpoints your key can reach, and what
// they return. Reads the key from the FANTASYPROS_API_KEY environment variable
// and never prints it. Run from the DynastyTool folder:
//   PowerShell:  $env:FANTASYPROS_API_KEY = "<your key>"; node scripts/fp-probe.mjs
//   bash:        FANTASYPROS_API_KEY=<your key> node scripts/fp-probe.mjs
const key = process.env.FANTASYPROS_API_KEY;
if (!key) { console.error('Set FANTASYPROS_API_KEY first (see the top of this file).'); process.exit(1); }

const Y = new Date().getFullYear();
const BASES = ['https://api.fantasypros.com/public/v2/json', 'https://api.fantasypros.com/v2/json'];
// Known endpoints (to confirm the key works) plus likely names for trade data.
const PATHS = [
  `nfl/${Y}/consensus-rankings?position=ALL&type=dynasty&scoring=PPR`,
  `nfl/players`,
  `nfl/trade-values`,
  `nfl/${Y}/trade-values`,
  `nfl/trade-values/dynasty`,
  `nfl/${Y}/trade-values?type=dynasty`,
  `nfl/trade-market-values`,
  `nfl/${Y}/trade-market-values?type=dynasty`,
  `nfl/trade-market-values/dynasty`,
  `nfl/${Y}/trade-market?type=dynasty`,
  `nfl/dynasty/trade-market`,
];

const shape = v => Array.isArray(v) ? `array(${v.length})${v.length ? ' of ' + shape(v[0]) : ''}`
  : v && typeof v === 'object' ? `{ ${Object.keys(v).slice(0, 12).join(', ')}${Object.keys(v).length > 12 ? ', …' : ''} }` : typeof v;

// Premium keys allow 1 request/second (500/day): space the calls out.
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const base of BASES) {
  for (const p of PATHS) {
    const url = `${base}/${p}`;
    await wait(1100);
    try {
      const r = await fetch(url, { headers: { 'x-api-key': key } });
      const text = await r.text();
      let body = '';
      if (r.ok) {
        try {
          const j = JSON.parse(text);
          // The shape, plus one sample row (the first item of the first list found).
          const list = Array.isArray(j) ? j : Object.values(j || {}).find(Array.isArray);
          body = shape(j) + (list && list.length ? `\n      sample: ${JSON.stringify(list[0]).slice(0, 500)}` : '');
        } catch { body = '(not JSON)'; }
      } else {
        body = text.replace(/\s+/g, ' ').slice(0, 160); // the error message, e.g. which plan is needed
      }
      console.log(`${r.status}  ${url.replace('https://api.fantasypros.com', '')}${body ? '\n      ' + body : ''}`);
    } catch (e) {
      console.log(`ERR  ${url} — ${e.message}`);
    }
  }
}
console.log('\nPaste this output back (it contains no key). 200 = reachable; 401/403 = not on your plan; 404 = no such endpoint; 429 = too fast (run again).');
