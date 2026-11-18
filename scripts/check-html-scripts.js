#!/usr/bin/env node
/* Parse all inline JavaScript on the website without requiring a browser.
   Run: node scripts/check-html-scripts.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
let checked = 0;
const pages = fs.readdirSync(root).filter(file => file.endsWith('.html'));
for (const file of pages) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const scripts = source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  let index = 0;
  for (const script of scripts) {
    index++;
    const attrs = script[1], body = script[2];
    if (!body.trim()) continue;
    const type = /\btype\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] || '';
    if (type && !['text/javascript', 'application/javascript'].includes(type)) continue; // modules need a separate module parser
    try {
      new vm.Script(body, { filename: file + ':script-' + index });
      checked++;
    } catch (e) {
      throw new Error('Invalid inline script in ' + file + ' #' + index + ': ' + e.message);
    }
  }
}
assert.ok(checked > 0, 'No inline scripts were found');
console.log('PASS ' + checked + ' inline JS blocks across ' + pages.length + ' pages');
