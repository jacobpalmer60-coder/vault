/* ============================================================
   VAULT NAV
   Injects one consistent header/nav into every page.
   Requires vault-core.js to be loaded first.
   Usage: <div id="vault-nav"></div> then <script src="vault-nav.js"></script>
   ============================================================ */
(function () {
  // Five tabs (user, 2026-10-20: "a little convoluted"): the main row is one tab per
  // group, opening its first page; a group with more than one page shows them as a
  // second row under it. Start/Sit, Waivers, Playoff Schedule and Rookie Draft were
  // removed; Season Report and the contend-or-rebuild plan live in the team view.
  const GROUPS = [
    { label: 'League', tabs: [
      { key: 'overview', short: 'Overview', label: 'League Overview', href: 'app.html' },
      { key: 'analyzer', short: 'Teams', label: 'Team Analyzer', href: 'team-analyzer.html' },
      { key: 'playoffs', short: 'Playoff Race', label: 'Playoff Race', href: 'playoffs.html' },
      { key: 'recap', short: 'Weekly Recap', label: 'Weekly Recap', href: 'weekly_recap.html' },
      { key: 'history', short: 'History', label: 'League History', href: 'league_history.html' }
    ] },
    { label: 'Trade Calculator', tabs: [
      { key: 'trade', short: 'Trade Calculator', label: 'Trade Calculator', href: 'trade.html' }
    ] },
    { label: 'Market', tabs: [
      { key: 'market', short: 'Player Market', label: 'Player Market', href: 'market.html' },
      { key: 'rankings', short: 'Rankings', label: 'Player Rankings', href: 'player_rankings.html' },
      { key: 'compare', short: 'Compare', label: 'Compare Players', href: 'compare.html' },
      { key: 'database', short: 'Trade Search', label: 'Trade Search', href: 'trade_database.html' }
    ] },
    { label: 'League Trades', tabs: [
      { key: 'grades', short: 'Trade Grades', label: 'Trade Grades', href: 'trade_grades.html' },
      { key: 'managers', short: 'Managers', label: 'Managers', href: 'managers.html' }
    ] },
    { label: 'Trade Lab', tabs: [
      { key: 'lab', short: 'Trade Lab', label: 'Trade Lab', href: 'trade_lab.html' }
    ] }
  ];
  const TABS = GROUPS.flatMap(g => g.tabs);
  // About-the-site pages: small links in the top row, not tabs.
  // Icons for the phone tab bar, one per group.
  const ICONS = {
    League: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>',
    'Trade Calculator': '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
    Market: '<path d="M4 19h16M6 15l4-5 4 3 5-7"/>',
    'League Trades': '<path d="M9 5h10M9 12h10M9 19h10M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2"/>',
    'Trade Lab': '<path d="M10 3h4M11 3v6l-5.5 9.5A1.7 1.7 0 0 0 7 21h10a1.7 1.7 0 0 0 1.5-2.5L13 9V3M8 15h8"/>'
  };
  const TAB_NAME = { 'Trade Calculator': 'Calculator', 'League Trades': 'Trades', 'Trade Lab': 'Lab' };
  const INFO = [
    { key: 'method', label: 'How We Grade', href: 'how_we_grade.html' },
    { key: 'patch', label: 'Patch Notes', href: 'patch_notes.html' },
    { key: 'status', label: 'Data status', href: 'status.html' }
  ];

  function currentPage() {
    // Normalize both sides to extension-less basenames before comparing — some
    // static hosts (the local "serve" dev server included) redirect ".html" URLs
    // to a clean-URL form, so location.pathname doesn't reliably end in ".html".
    const file = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    const found = [...TABS, ...INFO].find(t => t.href.replace(/\.html$/, '') === file);
    return found?.key || (file === 'index' || file === '' ? 'home' : '');
  }

  // Every tool needs your league and your team (user, 2026-10-20): the home page is
  // the way in. A tool opened without both (no league in the link or saved, or no
  // team saved for that league) goes to the home page, which asks for them and comes
  // back here. The home page and the info pages stay open to anyone.
  const isTool = TABS.some(t => t.key === currentPage());
  if (isTool) {
    const lid = Vault.getLeagueId();
    // An offer link (Copy offer link) opens on the trade for whoever gets it, saved team or not.
    const q = new URLSearchParams(location.search);
    const offerLink = /\/trade(\.html)?$/.test(location.pathname) && q.get('a') && q.get('b') && q.get('by');
    if (!lid || (!Vault.getMyTeamId(lid) && !offerLink)) { location.replace(Vault.pickLeagueLink()); return; }
  }

  // A line under the nav: an old season, or an IDP league.
  const notice = (inner, id = '') => `<div ${id ? `id="${id}"` : ''} class="card rounded-vault-sm px-4 py-3 text-[13px] text-zinc-300 flex flex-wrap items-center gap-x-3 gap-y-2">${inner}</div>`;

  function render() {
    const mount = document.getElementById('vault-nav');
    if (!mount) return;
    const active = currentPage();
    const leagueId = Vault.getLeagueId();

    // Wide screens: the five group tabs share the logo's row; the active group's pages sit under it.
    // Phones: the same five tabs as a bar along the bottom, and the group's pages under the logo.
    const activeGroup = GROUPS.find(g => g.tabs.some(t => t.key === active));
    const tabsHtml = GROUPS.map(g => {
      const on = g === activeGroup;
      return `<a href="${Vault.linkTo(g.tabs[0].href, leagueId)}" ${on ? 'aria-current="page"' : ''}
         class="relative px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors whitespace-nowrap shrink-0
                ${on ? 'text-white bg-white/[0.07]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'}">${g.label}</a>`;
    }).join('');
    const subHtml = activeGroup && activeGroup.tabs.length > 1 ? `<div class="max-w-[1400px] mx-auto px-4 sm:px-6 pb-2 flex items-center gap-1 overflow-x-auto scrollbar-none" role="group" aria-label="${activeGroup.label}">${activeGroup.tabs.map(t => `<a href="${Vault.linkTo(t.href, leagueId)}" ${active === t.key ? 'aria-current="page"' : ''} class="px-3 py-1.5 rounded-full text-[13px] sm:text-[12px] whitespace-nowrap transition-colors ${active === t.key ? 'bg-amber-400/15 text-amber-100' : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'}">${t.short}</a>`).join('')}</div>` : '';
    const barHtml = `<nav class="vn-bar" aria-label="Pages">${GROUPS.map(g => {
      const on = g === activeGroup;
      return `<a href="${Vault.linkTo(g.tabs[0].href, leagueId)}" ${on ? 'aria-current="page"' : ''} class="${on ? 'text-amber-300' : 'text-zinc-400'}"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[g.label]}</svg><span>${TAB_NAME[g.label] || g.label}</span></a>`;
    }).join('')}</nav>`;
    // How We Grade, Patch Notes, Data status and Switch League sit behind one button.
    const switchLink = `<a href="${leagueId ? 'index.html' : Vault.escapeHtml(Vault.pickLeagueLink())}" class="block px-3 py-2.5 sm:py-2 rounded-lg text-[14px] sm:text-[13px] text-zinc-200 hover:bg-white/[0.05]">${leagueId ? 'Switch League' : 'Pick your league'}</a>`;
    const moreHtml = `
      <div class="relative shrink-0">
        <button id="vnMore" type="button" aria-label="More pages" aria-expanded="false" aria-controls="vnMoreMenu" class="btn-ghost size-8 grid place-items-center"><svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
        <div id="vnMoreMenu" class="hidden absolute right-0 top-full mt-2 z-50 w-[200px] rounded-xl border border-white/10 bg-[#14161a] shadow-2xl p-1.5">
          ${INFO.map(t => `<a href="${Vault.linkTo(t.href, leagueId)}" ${active === t.key ? 'aria-current="page"' : ''} class="block px-3 py-2.5 sm:py-2 rounded-lg text-[14px] sm:text-[13px] ${active === t.key ? 'bg-amber-400/10 text-amber-100' : 'text-zinc-200 hover:bg-white/[0.05]'}">${t.label}</a>`).join('')}
          <div class="my-1 border-t border-white/[0.07]"></div>
          ${switchLink}
        </div>
      </div>`;

    // The page's content (its <main>, or the block right after the nav) is the
    // "Skip to content" target, so keyboard users don't tab through the nav on
    // every page.
    const main = document.querySelector('main') || mount.nextElementSibling;
    if (main) {
      if (!main.id) main.id = 'main';
      if (main.tagName !== 'MAIN') main.setAttribute('role', 'main');
      main.tabIndex = -1;
    }
    // Page load messages ("Loading league…", errors) are read out by screen readers.
    const status = document.getElementById('status');
    if (status && !status.hasAttribute('role')) status.setAttribute('role', 'status');

    // Which nav shows (tabs in the top row on wide screens, a bottom bar on phones) is
    // set here, not by the stylesheet: right after a deploy a browser can pair
    // this script with a cached older stylesheet, and the nav must still show.
    if (!document.getElementById('vn-style')) {
      const st = document.createElement('style');
      st.id = 'vn-style';
      st.textContent = `.vn-tabs{display:none}.vn-bar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:grid;grid-template-columns:repeat(5,1fr);padding-bottom:env(safe-area-inset-bottom);background:#0c0d10;border-top:1px solid rgba(255,255,255,.08)}
.vn-bar a{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0 7px;font-size:11px;font-weight:500;line-height:1}
body{padding-bottom:calc(60px + env(safe-area-inset-bottom))}#verdictDock{bottom:calc(68px + env(safe-area-inset-bottom))}
.scrollbar-none{scrollbar-width:none}.scrollbar-none::-webkit-scrollbar{display:none}
@media (min-width:768px){.vn-tabs{display:flex}.vn-bar{display:none}body{padding-bottom:0}#verdictDock{bottom:12px}}
@media print{.vn-bar{display:none}}`;
      document.head.appendChild(st);
    }

    mount.innerHTML = `
      ${main ? `<a href="#${main.id}" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-amber-400 focus:text-black focus:font-semibold">Skip to content</a>` : ''}
      <header class="z-40 border-b border-white/[0.07] bg-[#0c0d10]/95">
        <div class="max-w-[1400px] mx-auto px-4 sm:px-6 py-2 flex items-center gap-2 sm:gap-3">
          <a href="index.html" class="flex items-center gap-2 shrink-0 md:mr-2" aria-label="The Vault home">
            <img src="brand/vault-dial-128.png" alt="" width="32" height="32" class="size-7 shrink-0">
            <span class="hidden sm:block text-[15px] font-semibold tracking-[-0.01em] text-zinc-100 whitespace-nowrap">The Vault</span>
          </a>
          <nav aria-label="Pages" class="vn-tabs flex-1 min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none">${tabsHtml}</nav>
          <div class="flex flex-1 md:flex-none min-w-0 items-center justify-end gap-2">
            ${typeof PlayerCard !== 'undefined' ? '<button id="vnSearch" type="button" aria-label="Find a player or team" title="Find a player or team (Ctrl+K)" class="btn-ghost size-8 shrink-0 grid place-items-center"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></button>' : ''}
            <select id="myTeamPick" data-search="Your team…" aria-label="Your team" title="Your team — pages open on it and mark it with a You tag" class="hidden min-w-0 max-w-[190px] bg-[#14161a] border border-white/10 rounded-lg px-2 py-1.5 text-[12px] text-zinc-200"></select>
            ${moreHtml}
          </div>
        </div>
        ${subHtml}
      </header>
      <div id="vnNotices" class="max-w-[1400px] mx-auto px-4 sm:px-6 empty:hidden flex flex-col gap-2 pt-3"></div>
      ${barHtml}`;
    // Between phone and full desktop the row can still overflow: start it at the current tab.
    const row = mount.querySelector('.vn-tabs'), cur = row.querySelector('[aria-current]');
    if (cur && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, cur.offsetLeft - row.offsetLeft - 24);
    const sub = mount.querySelector('header [role="group"]'), subCur = sub?.querySelector('[aria-current]');
    if (subCur && sub.scrollWidth > sub.clientWidth) sub.scrollLeft = Math.max(0, subCur.offsetLeft - sub.offsetLeft - 24);
    // The more menu opens and closes on its button, Escape, or a tap outside.
    const btn = document.getElementById('vnMore'), menu = document.getElementById('vnMoreMenu');
    const setOpen = open => { menu.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', () => setOpen(menu.classList.contains('hidden')));
    document.addEventListener('click', e => { if (!menu.contains(e.target) && !btn.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.classList.contains('hidden')) { setOpen(false); btn.focus(); } });
  }

  // "Your team" picker: small Sleeper calls (league, users, rosters), independent
  // of whatever the page itself loads, so it's the same on every page. Picking a
  // team saves it for this league and reloads so the page opens on it.
  const reloadOnTeam = () => {
    const u = new URL(location.href);
    // Drop a shared trade's own team params (a/b/give_a/give_b/by), or the Trade
    // Calculator would reopen on the old team from the URL.
    ['a', 'b', 'give_a', 'give_b', 'by'].forEach(k => u.searchParams.delete(k));
    location.href = u.toString();
  };
  // Sleeper starts a new league each season: an old season's league is over.
  // Find this league's current season through its owners' leagues this season
  // (each points back at last season's with previous_league_id).
  async function currentSeasonOf(league, users, season) {
    const key = 'vault_next_season_' + league.league_id;
    try { const hit = sessionStorage.getItem(key); if (hit) return hit === '-' ? null : JSON.parse(hit); } catch {}
    const get = u => fetch(u).then(r => r.json()).catch(() => null);
    let calls = 0, found = null;
    for (const u of (users || []).slice(0, 4)) {
      const ls = (await get(`https://api.sleeper.app/v1/user/${u.user_id}/leagues/nfl/${season}`)) || [];
      for (const l of ls.filter(Vault.isDynastyLeague)) {
        let prev = l.previous_league_id;
        for (let hop = 0; prev && hop < 8 && calls < 40; hop++) {
          if (prev === league.league_id) { found = { id: l.league_id, season: l.season }; break; }
          const p = await get(`https://api.sleeper.app/v1/league/${prev}`); calls++;
          if (!p || +p.season < +league.season) break;
          prev = p.previous_league_id;
        }
        if (found || calls >= 40) break;
      }
      if (found || calls >= 40) break;
    }
    try { sessionStorage.setItem(key, found ? JSON.stringify(found) : '-'); } catch {}
    return found;
  }
  // The daily jobs normally keep these under a day old. Only speaks up when one really fell behind.
  async function dataAgeNotice() {
    const box = document.getElementById('vnNotices');
    if (!box) return;
    const read = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [ktc, proj] = await Promise.all([read('data/ktc-values.json'), read('data/projections.json')]);
    const days = iso => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : 0);
    const old = [['KTC values', days(ktc?.updated)], ['Projections', days(proj?.updated)]].filter(([, d]) => d > 2);
    if (old.length) box.insertAdjacentHTML('beforeend', notice(`<span>${old.map(([what, d]) => `${what} are ${Math.floor(d)} days old`).join(', ')}: the daily update is behind, so numbers here may be out of date.</span><a href="status.html" class="text-amber-200 hover:text-amber-100 underline underline-offset-2 decoration-amber-200/30">Data status</a>`));
  }
  function firstVisitTips() {
    const box = document.getElementById('vnNotices'), key = 'vault_tips_seen';
    let seen = true;
    try { seen = !!localStorage.getItem(key); } catch {}
    if (!box || seen || !isTool) return;
    const act = matchMedia('(hover: none)').matches ? 'Tap' : 'Click';
    box.insertAdjacentHTML('beforeend', notice(`<span>${act} any player or team name for its card. Dotted words and a small ? explain themselves. The magnifying glass finds anyone.</span><button id="vnTipsOk" class="text-amber-200 hover:text-amber-100 underline underline-offset-2 decoration-amber-200/30">Got it</button>`, 'vnTips'));
    document.getElementById('vnTipsOk').onclick = () => { try { localStorage.setItem(key, '1'); } catch {} document.getElementById('vnTips')?.remove(); };
  }
  async function leagueNotices(league, users) {
    const box = document.getElementById('vnNotices');
    if (!box || !league) return;
    const esc = Vault.escapeHtml;
    const link = (href, text) => `<a href="${esc(href)}" class="text-amber-200 hover:text-amber-100 underline underline-offset-2 decoration-amber-200/30">${text}</a>`;
    const IDP = ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S', 'IDP_FLEX'];
    if ((league.roster_positions || []).some(p => IDP.includes(p))) {
      const k = 'vault_note_idp_' + league.league_id;
      let seen = false;
      try { seen = !!localStorage.getItem(k); } catch {}
      if (!seen) {
        box.insertAdjacentHTML('beforeend', notice(`<span>IDP league: defensive players have no trade values here (KeepTradeCut doesn't rank them), so team values, trades and lineups count offense only.</span><button type="button" id="vnIdpOk" class="text-[12px] text-zinc-400 hover:text-white">Got it</button>`, 'vnIdp'));
        document.getElementById('vnIdpOk').onclick = () => { try { localStorage.setItem(k, '1'); } catch {} document.getElementById('vnIdp')?.remove(); };
      }
    }
    const state = await fetch('https://api.sleeper.app/v1/state/nfl').then(r => r.json()).catch(() => null);
    const season = state?.league_season || state?.season;
    if (season && league.season && +league.season < +season) {
      box.insertAdjacentHTML('beforeend', notice(`<span>This is ${esc(league.name)}'s ${esc(String(league.season))} season, which is over: Sleeper starts a new league each season.</span><span id="vnNextSeason" class="text-zinc-500">Looking for its ${esc(String(season))} season…</span>`, 'vnOld'));
      const next = await currentSeasonOf(league, users, season);
      const el = document.getElementById('vnNextSeason');
      if (el) el.outerHTML = next ? link(Vault.linkTo(location.pathname.split('/').pop() || 'app.html', next.id), `Open the ${esc(String(next.season))} season →`) : link('index.html', 'Pick its current season on the home page →');
    }
  }
  async function mountMyTeamPicker() {
    const sel = document.getElementById('myTeamPick');
    if (!sel) return;
    const leagueId = Vault.getLeagueId();
    if (!leagueId) return;
    try {
      const [league, users, rosters] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json()),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json())
      ]);
      const userById = new Map((users || []).map(u => [u.user_id, u]));
      const teams = (rosters || []).map(r => {
        const u = userById.get(r.owner_id) || {};
        return { rosterId: r.roster_id, ownerId: r.owner_id, name: Vault.teamLabel(u, r.roster_id) };
      }).sort((a, b) => a.name.localeCompare(b.name));
      if (!teams.length) return; // no such league: the page says so itself
      const mine = Vault.myTeam(teams, leagueId);
      sel.innerHTML = `<option value="" disabled>Your team…</option>` + teams.map(t => `<option value="${t.rosterId}" ${mine && mine.rosterId === t.rosterId ? 'selected' : ''}>${Vault.escapeHtml(t.name)}</option>`).join('');
      sel.classList.remove('hidden');
      sel.onchange = () => { Vault.setMyTeamId(leagueId, sel.value || null); reloadOnTeam(); };
      leagueNotices(league, users);
    } catch (e) { /* the page works without the picker */ }
  }

  // Keyboard access for things that are clicked but aren't buttons or links
  // (sortable headers, expandable team rows, player rows, trade pieces): Tab
  // reaches them, and Enter or Space clicks them. Pages re-render these, so it
  // re-runs whenever the page changes.
  const NATIVE = 'a[href], button, input, select, textarea, summary, label, option, details';
  const CLICKABLE = '[onclick], th.sortable, tr.team-row, .mobile-team-card, [data-kbd], [data-player], [data-team]';
  function enhance() {
    document.querySelectorAll(CLICKABLE.split(', ').map(s => s + ':not([tabindex])').join(', ')).forEach(el => {
      if (el.matches(NATIVE)) return;
      el.tabIndex = 0;
      // Table rows and headers keep their table roles; anything else reads as a button.
      if (!el.matches('tr, th, td') && !el.hasAttribute('role')) el.setAttribute('role', 'button');
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!(el instanceof Element) || el.matches(NATIVE) || !el.matches(CLICKABLE)) return;
    e.preventDefault();
    el.click();
  });
  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });

  // The age check waits its turn: it reads files the page is already fetching, and those win.
  document.addEventListener('DOMContentLoaded', () => { render(); mountMyTeamPicker(); enhance(); setTimeout(dataAgeNotice, 6000); firstVisitTips(); });
})();
