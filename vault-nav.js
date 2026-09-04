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
    { key: 'trade', label: 'Trade Calculator', href: 'trade.html' }
  ];

  function currentPage() {
    const file = location.pathname.split('/').pop() || 'index.html';
    return TABS.find(t => t.href === file)?.key || (file === 'index.html' ? 'home' : '');
  }

  function render() {
    const mount = document.getElementById('vault-nav');
    if (!mount) return;
    const active = currentPage();
    const leagueId = Vault.getLeagueId();

    const tabsHtml = TABS.map(t => `
      <a href="${Vault.linkTo(t.href, leagueId)}"
         class="px-3.5 py-2 rounded-full text-[12px] font-medium transition whitespace-nowrap
                ${active === t.key
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                  : 'text-amber-200/50 border border-transparent hover:text-amber-200 hover:bg-amber-500/5'}">
        ${t.label}
      </a>`).join('');

    mount.innerHTML = `
      <header class="sticky top-0 z-40 border-b border-amber-500/10 bg-black/70 backdrop-blur-xl">
        <div class="max-w-[1500px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <a href="index.html" class="flex items-center gap-3 shrink-0">
            <div class="size-9 rounded-full bg-gradient-to-br from-amber-300 to-yellow-600 p-[1.5px] shadow-[0_0_20px_rgba(250,204,21,0.25)]">
              <div class="size-full rounded-full bg-black grid place-items-center"><span class="display text-base gold-text">V</span></div>
            </div>
            <div class="leading-none">
              <div class="display text-[17px] gold-text tracking-wide">THE VAULT</div>
              <div class="text-[9px] uppercase tracking-[0.2em] text-amber-200/40">Gold Standard</div>
            </div>
          </a>
          <nav class="flex items-center gap-1 overflow-x-auto scrollbar">${tabsHtml}</nav>
          <div class="flex items-center gap-2 shrink-0">
            <span class="hidden md:inline text-[11px] text-amber-200/40 mono">League ${Vault.escapeHtml(leagueId)}</span>
            <a href="index.html" class="text-[11px] px-3 py-1.5 rounded-full border border-amber-500/20 text-amber-200/70 hover:text-amber-200 hover:border-amber-500/40 transition">Switch League</a>
          </div>
        </div>
      </header>`;
  }

  document.addEventListener('DOMContentLoaded', render);
})();
