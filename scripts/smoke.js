#!/usr/bin/env node
/* Opens every page and fails on what a person would call broken: a script error, "undefined" or
   "NaN" on the page, a page wider than the phone, or a page that never finished loading.
   Run it against a local copy before pushing:

     npx serve -l 5191 .                                 (in another window)
     npm i --no-save puppeteer-core
     node scripts/smoke.js <leagueId> [more leagueIds...]

   Set CHROME to your browser's path if it isn't in the usual place, BASE for another address, and
   SHOTS to a folder to save a screenshot of each page.

   SEASON plays a time of year by rewriting what Sleeper answers: post (playoffs over, league
   complete), off (February, last season's league), predraft (a new season's league before its
   draft), pre (drafted, week 1 not played). Only Sleeper changes: the date and the site's own data
   files stay as they are today. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE || 'http://localhost:5191';
const SHOTS = process.env.SHOTS || '';
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const SEASON = process.env.SEASON || '';
const leagues = process.argv.slice(2);
// What Sleeper would say at that time of year, from what it says today.
const NEXT = '2027';
const STATE = {
  post: { season: '2026', league_season: '2026', season_type: 'post', week: 18, display_week: 18, leg: 18 },
  off: { season: '2026', league_season: NEXT, season_type: 'off', week: 0, display_week: 0, leg: 0, previous_season: '2026' },
  predraft: { season: NEXT, league_season: NEXT, season_type: 'pre', week: 0, display_week: 0, leg: 0, previous_season: '2026' },
  pre: { season: NEXT, league_season: NEXT, season_type: 'pre', week: 1, display_week: 1, leg: 1, previous_season: '2026' }
};
function rewrite(url, body) {
  const fresh = SEASON === 'predraft' || SEASON === 'pre';
  const empty = r => ({ ...r, settings: { ...r.settings, wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0, ppts: 0, ppts_decimal: 0 } });
  if (/\/state\/nfl/.test(url)) return { ...body, ...STATE[SEASON] };
  if (/\/league\/\d+$/.test(url)) return fresh ? { ...body, season: NEXT, status: SEASON === 'pre' ? 'in_season' : 'pre_draft' } : { ...body, status: 'complete' };
  if (/\/matchups\/\d+/.test(url) && fresh) return [];
  if (/\/transactions\/\d+/.test(url) && fresh) return [];
  if (/\/rosters$/.test(url) && fresh) return body.map(empty);
  if (/_bracket$/.test(url) && fresh) return [];
  if (/\/drafts$/.test(url) && SEASON === 'predraft') return (body || []).map(d => ({ ...d, status: 'pre_draft', season: NEXT }));
  return body;
}
if (!leagues.length || !CHROME) { console.error('Usage: node scripts/smoke.js <leagueId> [...] (set CHROME if it was not found)'); process.exit(2); }

// [page, tab or section to open]. League pages take the league in the address.
const PAGES = [['proof'], ['grade'], ['today'], ['app'], ['team-analyzer', 'overview'], ['team-analyzer', 'roster'], ['team-analyzer', 'season'], ['team-analyzer', 'future'],
  ['trade'], ['trade_grades'], ['trade_database'], ['trade_lab'], ['market'], ['player_rankings'], ['compare'], ['managers'], ['playoffs'], ['weekly_recap'], ['league_history']];
const FREE = ['how_we_grade', 'patch_notes', 'status', 'index'];
const SIZES = [['desktop', 1280, 900, false], ['phone', 375, 812, true]];
// Long prose can use these words on purpose. The page text is checked outside these.
const SKIP_TEXT = new Set(['patch_notes', 'how_we_grade']);
const IGNORE = [/Failed to load resource/, /favicon/, /api\.github\.com/];

async function visit(browser, url, label, [sizeName, width, height, mobile], key) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  // No cached copies: the local server leaks a file on every 304 and dies with EMFILE after a few sweeps.
  await page.setCacheEnabled(false);
  // League pages send you home until a team is picked, so pick one, or nothing here gets tested.
  await page.evaluateOnNewDocument(leagues => { leagues.forEach(id => localStorage.setItem(`vault_my_team_${id}`, '1')); localStorage.setItem('vault_tips_seen', '1'); }, leagues);
  if (SEASON) {
    await page.setRequestInterception(true);
    page.on('request', async req => {
      if (!req.url().includes('api.sleeper.app')) return req.continue();
      try {
        const res = await fetch(req.url()), body = await res.json();
        await req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rewrite(req.url(), body)) });
      } catch { req.continue().catch(() => {}); }
    });
  }
  const problems = [];
  page.on('pageerror', e => problems.push(`script error: ${String(e.message || e).slice(0, 160)}`));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.some(r => r.test(m.text()))) problems.push(`console: ${m.text().slice(0, 160)}`); });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Pages keep talking to Sleeper for a while, so wait for what's on screen to stop changing.
    let last = -1, still = 0;
    for (let i = 0; i < 40 && still < 3; i++) {
      await new Promise(r => setTimeout(r, 500));
      const size = await page.evaluate(() => document.body.innerText.length);
      still = size === last ? still + 1 : 0;
      last = size;
    }
  } catch { problems.push('never finished loading'); }
  const wanted = new URL(url).pathname;
  if (new URL(page.url()).pathname !== wanted) problems.push(`sent away to ${page.url()}`);
  const seen = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body, text = main.innerText;
    const loading = [...main.querySelectorAll('*')].filter(e => e.children.length === 0 && e.offsetParent && /^(Loading|Syncing)\b/.test(e.textContent.trim())).map(e => e.textContent.trim().slice(0, 40));
    return { hits: (text.match(/.{0,36}(\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b(?! ))[^\n]{0,24}/g) || []).slice(0, 4), wide: document.documentElement.scrollWidth - innerWidth, loading: loading.slice(0, 3) };
  }).catch(e => { problems.push(`page moved while being read: ${page.url()} (${String(e.message).slice(0, 60)})`); return { hits: [], wide: 0, loading: [] }; });
  if (!SKIP_TEXT.has(key)) seen.hits.forEach(h => problems.push(`on the page: "${h.trim()}"`));
  if (seen.wide > 1) problems.push(`${seen.wide}px wider than the screen`);
  seen.loading.forEach(t => problems.push(`still says "${t}"`));
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${label}-${sizeName}.png`.replace(/[^\w.-]/g, '_')), fullPage: true }).catch(() => {}); }
  await page.close();
  return problems;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  let bad = 0, count = 0;
  const report = (label, problems) => { count++; if (problems.length) { bad++; console.log(`FAIL ${label}`); problems.forEach(p => console.log(`     ${p}`)); } };
  for (const size of SIZES) {
    for (const key of FREE) report(`${key} ${size[0]}`, await visit(browser, `${BASE}/${key === 'index' ? '' : key}`, key, size, key));
    for (const league of leagues) for (const [p, tab] of PAGES) {
      const label = `${p}${tab ? `#${tab}` : ''} ${league.slice(-6)} ${size[0]}`;
      report(label, await visit(browser, `${BASE}/${p}?league_id=${league}${tab ? `#${tab}` : ''}`, `${p}-${tab || ''}-${league.slice(-6)}`, size, p));
    }
  }
  await browser.close();
  console.log(`${count - bad} of ${count} clean`);
  process.exit(bad ? 1 : 0);
})();
