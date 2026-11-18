#!/usr/bin/env node
/* Missing-season discovery must belong to the league, not the viewer. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = fs.readFileSync(path.join(__dirname, '..', 'league_history.html'), 'utf8');
const a = site.indexOf('async function allSeasons('), b = site.indexOf('async function loadSeason(', a);
assert.ok(a >= 0 && b > a);
const code = site.slice(a, b) + '\nallSeasons;';

function fixture({ oldName = 'League of Gold', oldOwners = ['B', 'C', 'D', 'E'], fakeOwners = ['B', 'C'], includeOld = true } = {}) {
  const ownerRows = ids => ids.map((id, i) => ({ roster_id: i + 1, owner_id: id }));
  const seasons = new Map([
    ['league/current', { league_id: 'current', season: 2026, name: 'League of Gold' }],
    ['league/current/rosters', ownerRows(['A', 'B', 'C', 'D'])],
    ['league/old/rosters', ownerRows(oldOwners)],
    ['league/fake/rosters', ownerRows(fakeOwners)]
  ]);
  const older = { league_id: 'old', season: 2025, name: oldName };
  const fake = { league_id: 'fake', season: 2025, name: 'League of Gold' };
  const get = async url => {
    if (seasons.has(url)) return seasons.get(url);
    const match = /^user\/([^/]+)\/leagues\/nfl\/(\d+)$/.exec(url);
    if (match && match[2] === '2025') {
      const owner = match[1];
      return [...(includeOld && oldOwners.includes(owner) ? [older] : []), ...(fakeOwners.includes(owner) ? [fake] : [])];
    }
    return [];
  };
  const Vault = {
    norm: s => String(s).toLowerCase().trim(),
    getMyTeamId: () => { throw new Error('League discovery consulted viewer team'); },
    fetchSeasonChain: async (id, league) => [{ leagueId: id, season: league.season }]
  };
  return vm.runInNewContext(code, { get, Vault, Map, Set, Array, Promise, Number, String, Error, encodeURIComponent });
}
(async () => {
  let seasons = await fixture()('current');
  assert.deepEqual([...seasons].map(x => x.leagueId), ['current', 'old'], 'most overlapping verified league wins over a similarly named distractor');
  console.log('PASS recovers older seasons using other managers without viewer ownership');

  seasons = await fixture({ oldName: 'Renamed Dynasty' })('current');
  assert.deepEqual([...seasons].map(x => x.leagueId), ['current', 'old'], 'rename accepted only with strong roster overlap');
  console.log('PASS renamed prior season with strong owner overlap');

  seasons = await fixture({ includeOld: false, fakeOwners: ['B'] })('current');
  assert.deepEqual([...seasons].map(x => x.leagueId), ['current'], 'single-manager match never imports unrelated league');
  console.log('PASS rejects uncorroborated same-name league');

  seasons = await fixture({ oldOwners: ['A', 'B', 'C', 'D'], fakeOwners: ['A', 'B', 'C', 'D'] })('current');
  assert.deepEqual([...seasons].map(x => x.leagueId), ['current'], 'ambiguous competing histories are not guessed');
  console.log('PASS rejects ambiguous equally strong continuations');
  console.log('All multi-owner league history tests passed.');
})().catch(err => { console.error(err); process.exitCode = 1; });
