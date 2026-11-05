#!/usr/bin/env node
/* vault-core.js also runs outside a browser: the crawl's pricing and the nightly update load it
   in Node (scripts/lib-market.js). Anything top-level that needs a browser stops both, as it
   did on 2026-11-05. Run this after changing vault-core.js. */
const { loadVault } = require('./lib-market');
try {
  const Vault = loadVault();
  if (typeof Vault?.tradeSideValues !== 'function') throw new Error('Vault loaded without its math');
  // The crawler's name list and the site's have to stay the same list.
  const list = require('./name-aliases.json');
  if (JSON.stringify(list) !== JSON.stringify(Vault._nameAlias)) throw new Error('scripts/name-aliases.json and Vault._nameAlias differ');
  // Every explanation a page asks for has to exist.
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const files = fs.readdirSync(root).filter(f => /\.(html|js)$/.test(f) && f !== 'tailwind.css');
  const used = new Set();
  for (const f of files) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/Vault\.(?:term|info)\('(\w+)'|data-term="(\w+)"/g)) used.add(m[1] || m[2]);
  const missing = [...used].filter(k => !Vault.GLOSSARY[k]);
  if (missing.length) throw new Error(`no glossary entry for ${missing.join(', ')}`);
  console.log('vault-core.js loads outside a browser');
} catch (e) {
  console.error(`vault-core.js doesn't load outside a browser: ${e.message}`);
  process.exit(1);
}
