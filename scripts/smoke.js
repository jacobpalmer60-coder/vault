#!/usr/bin/env node
/* Opens every page and fails on what a person would call broken: a script error, "undefined" or
   "NaN" on the page, a page wider than the phone, or a page that never finished loading.
   Run it against a local copy before pushing:

     npx serve -l 5191 .                                 (in another window)
     npm i --no-save puppeteer-core
     node scripts/smoke.js <leagueId> [more leagueIds...]

   Set CHROME to your browser's path if it isn't in the usual place, BASE for another address, and
   SHOTS to a folder to save a screenshot of each page. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE || 'http://localhost:5191';
const SHOTS = process.env.SHOTS || '';
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const leagues = process.argv.slice(2);
if (!leagues.length || !CHROME) { console.error('Usage: node scripts/smoke.js <leagueId> [...] (set CHROME if it was not found)'); process.exit(2); }

// [page, tab or section to open]. League pages take the league in the address.
const PAGES = [['app'], ['team-analyzer', 'overview'], ['team-analyzer', 'roster'], ['team-analyzer', 'season'], ['team-analyzer', 'future'],
  ['trade'], ['trade_grades'], ['trade_database'], ['trade_lab'], ['market'], ['player_rankings'], ['compare'], ['managers'], ['playoffs'], ['weekly_recap'], ['league_history']];
const FREE = ['how_we_grade', 'patch_notes', 'status', 'index'];
const SIZES = [['desktop', 1280, 900, false], ['phone', 375, 812, true]];
// Long prose can use these words on purpose. The page text is checked outside these.
const SKIP_TEXT = new Set(['patch_notes', 'how_we_grade']);
const IGNORE = [/Failed to load resource/, /favicon/, /api\.github\.com/];

async function visit(browser, url, label, [sizeName, width, height, mobile], key) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  // League pages send you home until a team is picked, so pick one, or nothing here gets tested.
  await page.evaluateOnNewDocument(leagues => { leagues.forEach(id => localStorage.setItem(`vault_my_team_${id}`, '1')); localStorage.setItem('vault_tips_seen', '1'); }, leagues);
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
