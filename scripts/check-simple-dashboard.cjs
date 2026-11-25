'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),today=read('today.html'),home=read('index.html');
const order=['id="teamOutlook"','id="actionBox"','id="discoverLink"','id="teamDetails"','id="tiles"'];
assert.ok(order.every((k,i)=>today.includes(k)&&(i===0||today.indexOf(k)>today.indexOf(order[i-1]))));
for(const k of ['Find a trade','Check a trade','Review my roster','Not enough data','No clear need','Suggested direction'])assert.ok(today.includes(k),k);
assert.ok(today.includes('vault_lastvisit_${Vault.getLeagueId()}_${me.rosterId}'));
assert.ok(today.includes("Vault.linkTo('trade.html',leagueId)+'&coach=discover'"));
assert.ok(today.includes('<details')&&today.includes('<summary'));
assert.ok(home.includes('<details id="leagueIdDetails"')&&home.includes('role="alert"'));
assert.ok(home.includes('request !== activation')&&home.includes('finally { loadBtn.disabled = false'));
assert.ok(home.includes("return Vault.linkTo('today.html', id)"));
console.log('PASS simple-first dashboard structure, quick actions, optional analysis, team-isolated visit history and onboarding request guards');

const css=read('vault.css'),trade=read('trade.html'),nav=read('vault-nav.js');
for(const page of fs.readdirSync(path.join(__dirname,'..')).filter(x=>x.endsWith('.html'))){
 const html=read(page);
 if(html.includes('vault.css?'))assert.ok(html.includes('vault.css?v=af54b007'),page+' shared visual version');
 if(html.includes('vault-nav.js?'))assert.ok(html.includes('vault-nav.js?v=b1f8289e'),page+' shared navigation version');
}
assert.ok(today.includes('dash-action-primary')&&today.includes('vault-dashboard'));
assert.ok(trade.indexOf('id="siteStatus"')>trade.indexOf('id="tradeDetails"'));
assert.ok(trade.includes('id="advancedVerdict"')&&trade.includes('Pricing breakdown and team plans')&&trade.includes('Why it matters:'));
assert.ok(trade.includes("basis:'market'"),'no unsupported individual willingness claim in the verdict');
assert.ok(nav.includes("League:'Home'")&&nav.includes("Vault.linkTo('today.html',leagueId)"));
assert.ok(css.includes('prefers-reduced-motion')&&css.includes('min-height:44px'));
console.log('PASS modern shared visual assets, task-led navigation and progressive trade evidence');

const analyzer=read('team-analyzer.html'),managers=read('managers.html'),rankings=read('player_rankings.html');
assert.ok(analyzer.includes('More roster statistics')&&analyzer.includes('Data and projection coverage'));
assert.ok(analyzer.includes('&coach=discover&coach_for=')&&trade.includes("setupA.value = coachFor"));
assert.ok(managers.includes('More trade stats')&&managers.includes('managerColumnsExpanded'));
assert.ok(managers.includes('managerSummaryTable')&&managers.includes('managerMarketDetails'));
assert.ok(rankings.includes('More player stats')&&rankings.includes('rankingTable')&&rankings.includes('data-columns="basic"'));
console.log('PASS all-roster Discover access, progressive roster statistics, manager columns and player ranking evidence');

const profile=read('player-card.js'),market=read('market.html'),overview=read('app.html');
assert.ok(profile.includes('id="pcPerformance"')&&profile.includes('id="pcTradeHistory"'));
assert.ok(profile.includes("perf.addEventListener('toggle'")&&profile.includes("loadCardStats();"));
assert.ok(!profile.includes('if (!r.isPick) loadCardStats();'),'advanced history must not fetch on opening');
assert.ok(profile.includes('playerChartTooltip')&&profile.includes("'ArrowLeft','ArrowRight','Home','End'"));
assert.ok(market.includes('marketWatchlist')&&market.includes('Vault.isWatched(key)'));
assert.ok(overview.includes('pinnedChartTeam')&&overview.includes('chartReset'));
for(const page of fs.readdirSync(path.join(__dirname,'..')).filter(x=>x.endsWith('.html'))){
 const html=read(page);if(html.includes('player-card.js?v='))assert.ok(html.includes('player-card.js?v=f6f4f86c'),page+' player card stamp');
}
console.log('PASS profile progressive details, deferred history, watchlist shortcuts and chart controls');
