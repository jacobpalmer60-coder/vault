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
    { key: 'compare', label: 'Compare', href: 'compare.html' },
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
         class="relative px-3.5 py-2 rounded-full text-[12px] font-medium transition-colors whitespace-nowrap
                ${active === t.key
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                  : 'text-zinc-400 border border-transparent hover:text-white hover:bg-amber-500/5'}">
        ${t.label}
      </a>`).join('');
    const infoHtml = INFO.map(t => `<a href="${Vault.linkTo(t.href, leagueId)}" class="text-[11px] whitespace-nowrap transition-colors ${active === t.key ? 'text-amber-200' : 'text-zinc-400 hover:text-white'}">${t.label}</a>`).join('');

    mount.innerHTML = `
      <header class="md:sticky md:top-0 z-40 border-b border-white/[0.08] bg-[#0b0c0f]/95">
        <!-- Two rows: brand + settings on top, page tabs underneath (full width,
             scrolls sideways on phones), so adding a page never pushes the
             settings onto a wrapped row. -->
        <div class="max-w-[1800px] mx-auto px-4 sm:px-6 pt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <a href="index.html" class="flex items-center gap-3 shrink-0 group">
            <div class="size-9 rounded-full bg-gradient-to-br from-amber-300 to-yellow-600 p-[1.5px] shadow-[0_0_20px_rgba(250,204,21,0.25)] transition-shadow group-hover:shadow-[0_0_28px_rgba(250,204,21,0.4)]">
              <div class="size-full rounded-full bg-black grid place-items-center"><span class="display text-base gold-text">V</span></div>
            </div>
            <div class="leading-none">
              <div class="display text-[16px] gold-text tracking-wide">THE VAULT</div>
              <div class="text-[11px] uppercase tracking-[0.2em] text-amber-200/40">Gold Standard</div>
            </div>
          </a>
          <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            ${infoHtml}
            <select id="myTeamPick" aria-label="Your team" title="Your team — pages open on it and mark it with a You tag" class="hidden max-w-[190px] bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300"></select>
            <a href="index.html" class="btn-ghost text-[11px] px-3 py-1.5">Switch League</a>
          </div>
        </div>
        <nav class="max-w-[1800px] mx-auto px-4 sm:px-6 py-2 flex items-center gap-1 overflow-x-auto scrollbar" aria-label="Pages">${tabsHtml}</nav>
      </header>`;
    // On a phone the tab row scrolls sideways — start it at the current page's
    // tab instead of always at League Overview.
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
      sel.onchange = () => { Vault.setMyTeamId(leagueId, sel.value || null); location.reload(); };
    } catch (e) { /* picker is optional; the page works without it */ }
  }

  document.addEventListener('DOMContentLoaded', () => { render(); mountMyTeamPicker(); });
})();
