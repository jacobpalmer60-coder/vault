#!/usr/bin/env node
// Today's Dynasty Daddy trade values for the Trade Calculator's side-by-side
// bars (Vault.dynastyDaddyRead). Their public, keyless endpoint, once a day, as
// their API page asks ("please cache responses"):
// https://dynasty-daddy.com/help/api-documentation
//
// That endpoint has no draft picks, so 2027-2029 picks come from the market feed
// Dynasty Daddy's own public stream-tools reads, with the same player values.
//
// A failed fetch keeps yesterday's numbers and doesn't fail the daily update.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL_DYNASTY = 'https://api.dynasty-daddy.com/api/v1/values/dynasty';
const URL_MARKET = 'https://dynasty-daddy.com/api/v1/player/all/market/14';
const HEADERS = { 'User-Agent': 'TheVault/1.0 (dynasty trade calculator)' };
const PICK_ID = /^[0-9]{4}(early|mid|late)[1-4](st|nd|rd|th)pi$/;
const OUT = path.join(__dirname, '..', 'data', 'dynasty-daddy-values.json');

// Pick id: [1QB value, superflex value]; yesterday's if the feed is down.
async function fetchPicks() {
  try {
    const res = await fetch(URL_MARKET, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const picks = {};
    for (const p of await res.json()) {
      if (PICK_ID.test(p.name_id)) picks[p.name_id] = [p.trade_value, p.sf_trade_value];
    }
    if (Object.keys(picks).length < 30) throw new Error('too few picks');
    return picks;
  } catch (e) {
    console.warn(`Dynasty Daddy picks not updated: ${e.message}`);
    return JSON.parse(await fs.readFile(OUT, 'utf8').catch(() => '{}')).picks || {};
  }
}

try {
  const res = await fetch(URL_DYNASTY, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list) || list.length < 300) throw new Error(`only ${list?.length} players`);
  // Sleeper id: [1QB value, superflex value, Dynasty Daddy's id for its trade links]
  const players = {};
  for (const p of list) {
    if (p.sleeper_id) players[p.sleeper_id] = [p.trade_value, p.sf_trade_value, p.name_id];
  }
  const picks = await fetchPicks();
  await fs.writeFile(OUT, JSON.stringify({ source: 'dynasty-daddy.com', updated: new Date().toISOString(), count: Object.keys(players).length, players, picks }));
  console.log(`Dynasty Daddy: ${Object.keys(players).length} players, ${Object.keys(picks).length} picks`);
} catch (e) {
  console.warn(`Dynasty Daddy values not updated: ${e.message}`);
}
