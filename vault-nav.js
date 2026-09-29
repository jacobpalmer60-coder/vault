/* ============================================================
   VAULT NAV
   Injects one consistent header/nav into every page.
   Requires vault-core.js to be loaded first.
   Usage: <div id="vault-nav"></div> then <script src="js/vault-nav.js"></script>
   ============================================================ */
(function () {
  const TABS = [
    { key: 'overview', label: 'League Overview', href: 'app.html' },
    { key: 'analyzer', label: 'Team Analyzer', href: 'team-analyzer.html' },
    { key: 'rankings', label: 'Player Rankings', href: 'player_rankings.html' },
    { key: 'compare', label: 'Compare Players', href: 'compare.html' },
    { key: 'trade', label: 'Trade Calculator', href: 'trade.html' },
    { key: 'grades', label: 'Trade Grades', href: 'trade_grades.html' },
    { key: 'database', label: 'Trade Database', href: 'trade_database.html' },
    { key: 'managers', label: 'Managers', href: 'managers.html' }
  ];
  // About-the-site pages: small links in the top row, not tabs.
  const INFO = [
    { key: 'method', label: 'How We Grade', href: 'how_we_grade.html' },
    { key: 'patch', label: 'Patch Notes', href: 'patch_notes.html' }
  ];

  function currentPage() {
    // Normalize both sides to extension-less basenames before comparing — some
    // static hosts (the local "serve" dev server included) redirect ".html" URLs
    // to a clean-URL form, so location.pathname doesn't reliably end in ".html".
    const file = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    const found = [...TABS, ...INFO].find(t => t.href.replace(/\.html$/, '') === file);
    return found?.key || (file === 'index' || file === '' ? 'home' : '');
  }

  function render() {
    const mount = document.getElementById('vault-nav');
    if (!mount) return;
    const active = currentPage();
    const leagueId = Vault.getLeagueId();

    const tabsHtml = TABS.map(t => `
      <a href="${Vault.linkTo(t.href, leagueId)}" ${active === t.key ? 'aria-current="page"' : ''}
         class="relative px-3 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap
                ${active === t.key
                  ? 'text-white bg-white/[0.07] after:absolute after:left-3 after:right-3 after:-bottom-[9px] after:h-[2px] after:rounded-full after:bg-amber-400'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'}">
        ${t.label}
      </a>`).join('');
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

    mount.innerHTML = `
      ${main ? `<a href="#${main.id}" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-amber-400 focus:text-black focus:font-semibold">Skip to content</a>` : ''}
      <header class="md:sticky md:top-0 z-40 border-b border-white/[0.07] bg-[#0c0d10]/95">
        <!-- Two rows: brand + settings on top, page tabs underneath (full width,
             scrolls sideways on phones), so adding a page never pushes the
             settings onto a wrapped row. -->
        <div class="max-w-[1800px] mx-auto px-4 sm:px-6 pt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <a href="index.html" class="flex items-center gap-2.5 shrink-0 py-1">
            <div class="size-8 rounded-lg bg-amber-400 grid place-items-center"><span class="text-[15px] font-bold text-[#1c1406] leading-none">V</span></div>
            <div class="leading-none">
              <div class="text-[15px] font-semibold tracking-[0.08em] text-zinc-100">THE VAULT</div>
              <div class="text-[11px] uppercase tracking-[0.18em] text-zinc-500 mt-1">Dynasty tools</div>
            </div>
          </a>
          <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            ${infoHtml}
            <select id="myTeamPick" data-search="Your team…" aria-label="Your team" title="Your team — pages open on it and mark it with a You tag" class="hidden max-w-[190px] bg-[#14161a] border border-white/10 rounded-lg px-2 py-1.5 text-[12px] text-zinc-200"></select>
            <a href="index.html" class="btn-ghost text-[12px] px-3 py-1.5">Switch League</a>
          </div>
        </div>
        <nav class="max-w-[1800px] mx-auto px-4 sm:px-6 py-2 flex items-center gap-1 overflow-x-auto scrollbar" aria-label="Pages">${tabsHtml}</nav>
      </header>`;
    // On a phone the tab row scrolls sideways — start it at the current page's
    // tab instead of always at League Overview.
    const header = mount.querySelector('header');
    const setNavH = () => document.documentElement.style.setProperty('--nav-h', (getComputedStyle(header).position === 'sticky' ? header.offsetHeight : 0) + 'px');
    setNavH();
    addEventListener('resize', setNavH);
    const nav = mount.querySelector('nav'), cur = nav.querySelector('[aria-current]');
    if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - nav.offsetLeft - 24);
  }

  // "Your team" picker — two small Sleeper calls (users + rosters), independent
  // of whatever the page itself loads, so it's the same on every page. Picking
  // a team saves it for this league and reloads so the page opens on it.
  async function mountMyTeamPicker() {
    const sel = document.getElementById('myTeamPick');
    if (!sel) return;
    const leagueId = Vault.getLeagueId();
    try {
      const [users, rosters] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json())
      ]);
      const userById = new Map((users || []).map(u => [u.user_id, u]));
      const teams = (rosters || []).map(r => {
        const u = userById.get(r.owner_id) || {};
        return { rosterId: r.roster_id, ownerId: r.owner_id, name: u.metadata?.team_name || u.display_name || `Team ${r.roster_id}` };
      }).sort((a, b) => a.name.localeCompare(b.name));
      if (!teams.length) return;
      const mine = Vault.myTeam(teams, leagueId);
      sel.innerHTML = `<option value="">Your team…</option>` + teams.map(t => `<option value="${t.rosterId}" ${mine && mine.rosterId === t.rosterId ? 'selected' : ''}>${Vault.escapeHtml(t.name)}</option>`).join('');
      sel.classList.remove('hidden');
      // Reload onto the new team: drop a shared trade's own team params (a/b/give_a/
      // give_b/by), or the Trade Calculator would reopen on the old team from the URL.
      sel.onchange = () => {
        Vault.setMyTeamId(leagueId, sel.value || null);
        const u = new URL(location.href);
        ['a', 'b', 'give_a', 'give_b', 'by'].forEach(k => u.searchParams.delete(k));
        location.href = u.toString();
      };
    } catch (e) { /* picker is optional; the page works without it */ }
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
