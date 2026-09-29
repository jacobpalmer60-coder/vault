#!/usr/bin/env node
/* ============================================================
   Version-stamps every stylesheet and script a page loads, e.g.
   tailwind.css -> tailwind.css?v=3f9a1c2e, from a hash of the file.
   GitHub Pages lets browsers keep files for ~10 minutes, so right after
   a deploy a browser could pair a new page with an old saved stylesheet
   (the page tabs vanished that way once). With the file's hash in the
   address, a changed file is a new address: every page always loads a
   matching set, with nothing for anyone to refresh.

   node scripts/stamp-assets.js          rewrite the stamps in every page
   node scripts/stamp-assets.js --check  exit 1 if any stamp is out of date
                                         (the pre-commit check runs this)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const check = process.argv.includes('--check');
// --check reads what's staged for the commit (git's index), so a page that was
// restamped but not staged still fails; otherwise it reads the files on disk.
const staged = f => { try { return execSync(`git show ":${f}"`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { return null; } };
const read = f => (check ? staged(f) : null) ?? fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
// Line endings normalized, so a checkout's CRLF/LF conversion never changes a stamp.
const hash = f => crypto.createHash('sha1').update(read(f).replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);

// Only committed pages (never a scratch page sitting untracked in the folder).
const pages = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const stamps = {};
const stale = [];

for (const page of pages) {
  const file = path.join(ROOT, page);
  const before = read(page);
  const after = before.replace(/(href|src)="([\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"/g, (whole, attr, asset) => {
    if (!exists(asset)) return whole;
    stamps[asset] = stamps[asset] || hash(asset);
    return `${attr}="${asset}?v=${stamps[asset]}"`;
  });
  if (after !== before) {
    stale.push(page);
    if (!check) fs.writeFileSync(file, after);
  }
}

if (check) {
  if (stale.length) {
    console.error(`Asset stamps are out of date in: ${stale.join(', ')}\nRun: node scripts/stamp-assets.js, then stage those pages.`);
    process.exit(1);
  }
  console.log('Asset stamps up to date.');
} else {
  console.log(stale.length ? `Stamped: ${stale.join(', ')}` : 'Asset stamps already up to date.');
}
