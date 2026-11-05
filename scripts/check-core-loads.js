#!/usr/bin/env node
/* vault-core.js also runs outside a browser: the crawl's pricing and the nightly update load it
   in Node (scripts/lib-market.js). Anything top-level that needs a browser stops both, as it
   did on 2026-11-05. Run this after changing vault-core.js. */
const { loadVault } = require('./lib-market');
try {
  const Vault = loadVault();
  if (typeof Vault?.tradeSideValues !== 'function') throw new Error('Vault loaded without its math');
  console.log('vault-core.js loads outside a browser');
} catch (e) {
  console.error(`vault-core.js doesn't load outside a browser: ${e.message}`);
  process.exit(1);
}
