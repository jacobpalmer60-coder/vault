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
  const openTag = html.match(new RegExp(`<script\\b(?=[^>]*\\bid\\s*=\\s*["']${id}["'])[^>]*>`, 'i'));
  if (!openTag) throw new Error(`Could not find <script id="${id}"> in page HTML`);
  const start = openTag.index + openTag[0].length;
  const end = html.indexOf('</script>', start);
  if (end === -1) throw new Error(`Could not find closing </script> for id="${id}"`);
  return JSON.parse(html.slice(start, end));
}

// Support both known KTC embeddings: the newer JSON data island and the
// earlier JS literal. Do not scrape incomplete visible rankings as a substitute:
// missing rows would corrupt every downstream value/grade snapshot.
function extractRankings(html) {
  try { return extractJsonScriptTag(html, 'ktc-players'); }
  catch (error) {
    const assign = /\b(?:var|let|const)\s+playersArray\s*=\s*(\[)/.exec(html);
    if (!assign) throw error;
    const start = assign.index + assign[0].lastIndexOf('[');
    let depth = 0, quote = '', escape = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (quote) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '[') depth++;
      else if (ch === ']' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
    throw Error('KTC playersArray assignment was truncated');
  }
}

async function main() {
  // KTC sometimes returns an incomplete/interstitial HTML page. Retrying a
  // missing data island avoids losing the entire daily refresh to a transient
  // response, while validation below prevents publishing an empty price book.
  let all, sourceVersion=null;
  let lastError;
  let lastPageInfo;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      all=null; sourceVersion=null;
      const pageUrl=new URL(PAGE_URL);pageUrl.searchParams.set('_vault_refresh',String(Date.now()));
      const res = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'text/html', 'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      const html = await res.text();
      // Safe debugging metadata only: never print raw HTML, cookies, or identities.
      lastPageInfo = {
        status: res.status,
        bytes: html.length,
        title: (html.match(/<title[^>]*>([^<]{0,120})<\/title>/i) || [])[1] || null,
        hasDataIsland: html.includes('ktc-players'),
        hasLegacyArray: html.includes('playersArray'),
        hasBlendValueKeys: html.includes('blendValue'),
        hasOneQBValueKeys: html.includes('oneQBValues'),
        hasRenderedRanks: html.includes('rankings-page-rankings'),
        legacyExcerpt: html.includes('playersArray') ? html.slice(Math.max(0, html.indexOf('playersArray') - 60), html.indexOf('playersArray') + 130).replace(/\s+/g, ' ') : null,
        hasChallengeText: /cloudflare|captcha|just a moment|access denied/i.test(html),
        scriptIds: [...html.matchAll(/<script[^>]*\bid=["']([^"']+)["']/gi)].slice(0, 10).map(m => m[1])
      };
      try { all = extractRankings(html); } catch { all=null; }
      if (!Array.isArray(all) || all.length < 320) {
        // The ranking page now initializes playersArray=[] and asynchronously
        // loads its complete values from its first-party versioned endpoint.
        const version = /\b(?:var|let|const)\s+playersVersion\s*=\s*['"]([a-zA-Z0-9-]{1,128})['"]/.exec(html)?.[1];
        if (!version) throw new Error('KTC page has no valid player-pool version');
        const poolUrl = new URL('/dynasty-rankings/player-pool', PAGE_URL);
        poolUrl.searchParams.set('v', version);
        poolUrl.searchParams.set('sr', '2');
        const poolResponse = await fetch(poolUrl, {
          headers: {
            Accept: 'application/json', 'Cache-Control': 'no-cache',
            Referer: PAGE_URL,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(30000)
        });
        if (!poolResponse.ok) throw new Error('KTC player pool fetch failed: ' + poolResponse.status);
        const stampedVersion = poolResponse.headers.get('x-ktc-players-version');
        // The endpoint returns one complete pool, not a delta. A cached HTML
        // bootstrap can advertise an older version while the endpoint serves a
        // newer coherent pool. Never mix page values with endpoint values.
        if(stampedVersion&&!/^[a-zA-Z0-9-]{1,128}$/.test(stampedVersion))throw Error('Invalid KTC pool version header');
        sourceVersion=stampedVersion||version;
        if(stampedVersion&&stampedVersion!==version)console.warn('KTC bootstrap/pool version differs; validating complete returned pool', {advertised:version,returned:stampedVersion});
        all = await poolResponse.json();
        console.log('KTC versioned player pool fetched', { count: all?.length, version });
      }
      if (!Array.isArray(all) || all.length < 320) throw new Error('Insufficient KTC player-pool rows: ' + (all?.length ?? 0));
      const ids=new Set();
      for(const p of all){
        if(!p||!Number.isFinite(+p.playerID)||ids.has(String(p.playerID))||typeof p.playerName!=='string'||!p.playerName.trim()||typeof p.position!=='string')throw Error('Malformed or duplicate KTC pool identity');
        ids.add(String(p.playerID));
        const v=[p.oneQBValues,p.oneQBValues?.tep,p.oneQBValues?.tepp,p.superflexValues,p.superflexValues?.tep,p.superflexValues?.tepp];
        if(v.some(x=>!Number.isFinite(x?.blendValue)||x.blendValue<0||x.blendValue>20000))throw Error('Malformed KTC blend prices');
      }
      break;
    } catch (error) {
      all=null;
      lastError = error;
      console.warn(`KTC rankings attempt ${attempt}/3 failed: ${error.message}`);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * (+process.env.KTC_RETRY_DELAY_MS || 5000)));
    }
  }
  if (!Array.isArray(all) || all.length < 320) {
    if (lastPageInfo) console.warn('KTC page shape (sanitized):', JSON.stringify(lastPageInfo));
    throw new Error(`KTC rankings unavailable after 3 attempts; keeping existing values: ${lastError?.message}`);
  }

  // KTC now lists BOTH a generic per-tier pick ("2027 Early 1st") and, for the
  // current season specifically, one entry per exact draft slot ("2026 Pick
  // 1.01") — the exact-slot ones don't match this pattern and are skipped
  // below, same as any other unrecognized name; we only ever wanted the
  // early/mid/late tier a pick falls in (see Vault.ktcPickSlot), not its exact
  // numbered slot, so losing nothing by ignoring the new format.
  const pickNamePattern = /^(\d{4})\s+(Early|Mid|Late)\s+(\d+)(?:st|nd|rd|th)$/i;

  // KTC exposes three value sources per player — `.value` (Crowdsourced: daily
  // Keep/Trade/Cut votes, ELO-aggregated), `.vftValue` (Tradesourced: derived from
  // their real trade database), and `.blendValue` (Crowd + Trade, their own
  // recommended default for "the perfect blend"). Using the blend rather than pure
  // Crowdsourced matches the rest of this app's direction this session — need-
  // aware fairness, the ported consolidation algorithm, calibrating against real
  // trades — all grounded in actual trade behavior, not just crowd sentiment.
  // Deliberately NOT pure Tradesourced: by KTC's own explanation, a rookie has NO
  // tradesourced value at all before they're drafted (can't trade a player who
  // isn't rosterable yet), and any thinly-traded player is noisy — the blend still
  // leans on crowd data to cover exactly those gaps.
  const players = [];
  const picks = [];
  for (const p of all) {
    const row = {
      oneQB: p.oneQBValues.blendValue,
      oneQB_tep: p.oneQBValues.tep.blendValue,
      oneQB_tepp: p.oneQBValues.tepp.blendValue,
      sf: p.superflexValues.blendValue,
      sf_tep: p.superflexValues.tep.blendValue,
      sf_tepp: p.superflexValues.tepp.blendValue
    };
    const slug=typeof p.slug==='string'&&/^[a-zA-Z0-9_-]+$/.test(p.slug)?p.slug:null;
    if (p.position === 'RDP') {
      const m = p.playerName.match(pickNamePattern);
      if (!m) continue; // unrecognized pick name format — skip rather than guess
      picks.push({ season: +m[1], slot: m[2].toLowerCase(), round: +m[3], ktcId: p.playerID, slug, ...row });
    } else {
      players.push({ name: p.playerName, ktcId: p.playerID, slug, pos: p.position, team: p.team || '', age: p.age || null, rookie: !!p.rookie, ...row });
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
    valueSource: 'blend',
    sourceVersion,
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
