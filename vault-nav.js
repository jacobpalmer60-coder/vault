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
    { key: 'trade', label: 'Trade Calculator', href: 'trade.html' },
    { key: 'grades', label: 'Trade Grades', href: 'trade_grades.html' },
    { key: 'database', label: 'Trade Database', href: 'trade_database.html' },
    { key: 'managers', label: 'Managers', href: 'managers.html' }
  ];

  function currentPage() {
    // Normalize both sides to extension-less basenames before comparing — some
    // static hosts (the local "serve" dev server included) redirect ".html" URLs
    // to a clean-URL form, so location.pathname doesn't reliably end in ".html".
    const file = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    const found = TABS.find(t => t.href.replace(/\.html$/, '') === file);
    return found?.key || (file === 'index' || file === '' ? 'home' : '');
  }

  function render() {
    const mount = document.getElementById('vault-nav');
    if (!mount) return;
    const active = currentPage();
    const leagueId = Vault.getLeagueId();

    const tabsHtml = TABS.map(t => `
      <a href="${Vault.linkTo(t.href, leagueId)}"
         class="relative px-3.5 py-2 rounded-full text-[12px] font-medium transition-colors whitespace-nowrap
                ${active === t.key
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                  : 'text-zinc-400 border border-transparent hover:text-white hover:bg-amber-500/5'}">
        ${t.label}
      </a>`).join('');

    mount.innerHTML = `
      <header class="sticky top-0 z-40 border-b border-white/8 bg-black/70 backdrop-blur-xl">
        <div class="max-w-[1500px] mx-auto px-4 sm:px-6 h-16 flex flex-wrap items-center justify-between gap-3">
          <a href="index.html" class="flex items-center gap-3 shrink-0 group">
            <div class="size-9 rounded-full bg-gradient-to-br from-amber-300 to-yellow-600 p-[1.5px] shadow-[0_0_20px_rgba(250,204,21,0.25)] transition-shadow group-hover:shadow-[0_0_28px_rgba(250,204,21,0.4)]">
              <div class="size-full rounded-full bg-black grid place-items-center"><span class="display text-base gold-text">V</span></div>
            </div>
            <div class="leading-none">
              <div class="display text-[16px] gold-text tracking-wide">THE VAULT</div>
              <div class="text-[11px] uppercase tracking-[0.2em] text-amber-200/40">Gold Standard</div>
            </div>
          </a>
          <nav class="flex items-center gap-1 overflow-x-auto scrollbar">${tabsHtml}</nav>
          <div class="flex items-center gap-2.5 shrink-0">
            <span class="hidden md:inline text-[11px] text-amber-200/40 mono">League ${Vault.escapeHtml(leagueId)}</span>
            <a href="index.html" class="btn-ghost text-[11px] px-3 py-1.5">Switch League</a>
          </div>
        </div>
      </header>`;
  }

  document.addEventListener('DOMContentLoaded', render);
})();
