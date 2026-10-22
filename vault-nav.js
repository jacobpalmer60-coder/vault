/* ============================================================
   VAULT NAV
   Injects one consistent header/nav into every page.
   Requires vault-core.js to be loaded first.
   Usage: <div id="vault-nav"></div> then <script src="js/vault-nav.js"></script>
   ============================================================ */
(function () {
  // Five tabs (user, 2026-10-20: "a little convoluted"): the main row is one tab per
  // group, opening its first page; a group with more than one page shows them as a
  // second row under it. Start/Sit, Waivers, Playoff Schedule and Rookie Draft were
  // removed; Season Report and the contend-or-rebuild plan live in the team view.
  const GROUPS = [
    { label: 'League', tabs: [
      { key: 'overview', short: 'Overview', label: 'League Overview', href: 'app.html' },
      { key: 'analyzer', short: 'Teams', label: 'Team Analyzer', href: 'team-analyzer.html' }
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
    if (!lid || !Vault.getMyTeamId(lid)) { location.replace(Vault.pickLeagueLink()); return; }
  }

  // A line under the nav: an old season, or an IDP league.
  const notice = (inner, id = '') => `<div ${id ? `id="${id}"` : ''} class="card rounded-vault-sm px-4 py-3 text-[13px] text-zinc-300 flex flex-wrap items-center gap-x-3 gap-y-2">${inner}</div>`;

  function render() {
    const mount = document.getElementById('vault-nav');
    if (!mount) return;
    const active = currentPage();
    const leagueId = Vault.getLeagueId();

    // Wide screens: the five group tabs, then the active group's pages as a second row.
    const activeGroup = GROUPS.find(g => g.tabs.some(t => t.key === active));
    const tabsHtml = GROUPS.map(g => {
      const on = g === activeGroup;
      return `<a href="${Vault.linkTo(g.tabs[0].href, leagueId)}" ${on ? 'aria-current="page"' : ''}
         class="relative px-3.5 py-2 rounded-lg text-[14px] font-medium transition-colors whitespace-nowrap shrink-0
                ${on
                  ? 'text-white bg-white/[0.07] after:absolute after:left-3 after:right-3 after:-bottom-[9px] after:h-[2px] after:rounded-full after:bg-amber-400'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'}">${g.label}</a>`;
    }).join('');
    const subHtml = activeGroup && activeGroup.tabs.length > 1 ? `<div class="vn-row max-w-[1400px] mx-auto px-4 sm:px-6 pb-2 items-center gap-1 overflow-x-auto scrollbar" role="group" aria-label="${activeGroup.label}">${activeGroup.tabs.map(t => `<a href="${Vault.linkTo(t.href, leagueId)}" ${active === t.key ? 'aria-current="page"' : ''} class="px-3 py-1.5 rounded-full text-[12px] whitespace-nowrap transition-colors ${active === t.key ? 'bg-amber-400/15 text-amber-100' : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'}">${t.short}</a>`).join('')}</div>` : '';
    // Phones: one button naming the current page; it opens the same groups as a list.
    const here = [...TABS, ...INFO].find(t => t.key === active);
    const menuHtml = `
      <div class="vn-menu max-w-[1400px] mx-auto px-4 py-2 relative">
        <button id="navMenuBtn" type="button" aria-expanded="false" aria-controls="navMenu"
          class="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-white/[0.05] border border-white/10 text-[14px] font-medium text-zinc-100">
          <span>${here ? here.label : 'Pages'}</span>
          <span class="flex items-center gap-1.5 text-[12px] text-zinc-400">All pages <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
        </button>
        <div id="navMenu" class="hidden absolute left-4 right-4 top-full -mt-1 z-50 rounded-xl border border-white/10 bg-[#14161a] shadow-2xl p-3 space-y-3">
          ${GROUPS.map(g => `<div role="group" aria-label="${g.label}">
            <div class="px-2 pb-1 text-[11px] uppercase tracking-[0.12em] text-zinc-500" aria-hidden="true">${g.label}</div>
            <div class="grid grid-cols-2 gap-1">${g.tabs.map(t => `<a href="${Vault.linkTo(t.href, leagueId)}" ${active === t.key ? 'aria-current="page"' : ''} class="px-3 py-2.5 rounded-lg text-[14px] ${active === t.key ? 'bg-amber-400/10 text-amber-100' : 'text-zinc-200 hover:bg-white/[0.05]'}">${t.label}</a>`).join('')}</div>
          </div>`).join('')}
        </div>
      </div>`;
    const infoHtml = INFO.map(t => `<a href="${Vault.linkTo(t.href, leagueId)}" ${active === t.key ? 'aria-current="page"' : ''} class="text-[12px] whitespace-nowrap py-1.5 transition-colors ${active === t.key ? 'text-white' : 'text-zinc-400 hover:text-white'}">${t.label}</a>`).join('');

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

    // Which nav shows (tab row on wide screens, All pages menu on phones) is
    // set here, not by the stylesheet: right after a deploy a browser can pair
    // this script with a cached older stylesheet, and the nav must still show.
    if (!document.getElementById('vn-style')) {
      const st = document.createElement('style');
      st.id = 'vn-style';
      st.textContent = '.vn-row{display:none}.vn-menu{display:block}@media (min-width:768px){.vn-row{display:flex}.vn-menu{display:none}}';
      document.head.appendChild(st);
    }

    mount.innerHTML = `
      ${main ? `<a href="#${main.id}" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-amber-400 focus:text-black focus:font-semibold">Skip to content</a>` : ''}
      <header class="z-40 border-b border-white/[0.07] bg-[#0c0d10]/95">
        <!-- Two rows: brand + settings on top, page tabs underneath (full width,
             scrolls sideways on phones), so adding a page never pushes the
             settings onto a wrapped row. -->
        <div class="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <a href="index.html" class="flex items-center gap-2.5 shrink-0 py-1">
            <img src="brand/vault-dial-128.png" alt="" width="32" height="32" class="size-8 shrink-0">
            <div class="leading-none">
              <div class="text-[16px] font-semibold tracking-[-0.01em] text-zinc-100">The Vault</div>
              <div class="text-[11px] text-zinc-500 mt-1">Dynasty tools for Sleeper</div>
            </div>
          </a>
          <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            ${infoHtml}
            <select id="myTeamPick" data-search="Your team…" aria-label="Your team" title="Your team — pages open on it and mark it with a You tag" class="hidden max-w-[190px] bg-[#14161a] border border-white/10 rounded-lg px-2 py-1.5 text-[12px] text-zinc-200"></select>
            <a href="${leagueId ? 'index.html' : Vault.escapeHtml(Vault.pickLeagueLink())}" class="btn-ghost text-[12px] px-3 py-1.5">${leagueId ? 'Switch League' : 'Pick your league'}</a>
          </div>
        </div>
        <nav aria-label="Pages">
          <div class="vn-row max-w-[1400px] mx-auto px-4 sm:px-6 py-2 items-center gap-1 overflow-x-auto scrollbar">${tabsHtml}</div>
          ${subHtml}
          ${menuHtml}
        </nav>
      </header>
      <div id="vnNotices" class="max-w-[1400px] mx-auto px-4 sm:px-6 empty:hidden flex flex-col gap-2 pt-3"></div>`;
    // Between phone and full desktop the row can still overflow: start it at the current tab.
    const row = mount.querySelector('nav > div'), cur = row.querySelector('[aria-current]');
    if (cur && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, cur.offsetLeft - row.offsetLeft - 24);
    // Phone menu: opens and closes on the button, Escape, or a tap outside.
    const btn = document.getElementById('navMenuBtn'), menu = document.getElementById('navMenu');
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
        return { rosterId: r.roster_id, ownerId: r.owner_id, name: u.metadata?.team_name || u.display_name || `Team ${r.roster_id}` };
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
  const CLICKABLE = '[onclick], th.sortable, tr.team-row, .mobile-team-card, [data-kbd]';
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

  document.addEventListener('DOMContentLoaded', () => { render(); mountMyTeamPicker(); enhance(); });
})();
