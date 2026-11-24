#!/usr/bin/env node
'use strict';
// Check every public page, not just the small set used in browser fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter(x => x.endsWith('.html'));
const missing = [], duplicateIds = [], versions = new Map();
let links = 0;
for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const seen = new Set();
  for (const match of html.matchAll(/\bid=["']([^"']+)["']/g)) {
    const id = match[1];
    if (id.includes('$'+'{')) continue; // dynamic template-generated ID
    if (seen.has(id)) duplicateIds.push(page + '#' + id);
    seen.add(id);
  }
  for (const match of html.matchAll(/\b(href|src|action)=["']([^"']+)["']/g)) {
    const raw = match[2];
    if (!raw || /^([a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(raw) || raw.includes('$'+'{')) continue;
    const local = raw.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!local || local.endsWith('/')) continue;
    links++;
    if (!fs.existsSync(path.join(ROOT, local))) missing.push(page + ' => ' + raw);
    if (match[1] === 'src' && local.endsWith('.js')) {
      const list = versions.get(local) || new Set();
      list.add(raw);
      versions.set(local, list);
    }
  }
}
assert.deepEqual(missing, [], 'Broken local page links/assets');
assert.deepEqual(duplicateIds, [], 'Duplicate literal element IDs');
assert.deepEqual([...versions].filter(([, x]) => x.size > 1).map(([f, x]) => f + ': ' + [...x].join(', ')), [],
  'Shared scripts have conflicting cache-busting stamps');
const status = fs.readFileSync(path.join(ROOT, 'status.html'), 'utf8');
const lab = fs.readFileSync(path.join(ROOT, 'trade_lab.html'), 'utf8');
assert.match(status, /Unified Sleeper ingestion/, 'Status must name active collector');
assert.match(status, /Sleeper market pricing/, 'Status must expose independently monitored repricing health');
assert.match(status, /Trade-crawl summaries have not refreshed within 6 hours/i, 'Warn when market history is stale');
assert.match(status, /Historical research snapshots/, 'Show research freshness independently');
assert.doesNotMatch(lab, /refreshed after each full pull of leagues/, 'Historical research does not refresh with each crawl');
assert.match(lab, /historical research snapshot/, 'Trade Lab must label its research snapshot');
console.log('PASS: ' + pages.length + ' public pages, ' + links + ' static assets/links, consistent script cache keys and honest data status');
