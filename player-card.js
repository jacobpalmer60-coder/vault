/* The player card (user, 2026-11-05): click a player's name anywhere and it opens over the page.
   Vault.playerLink(name) marks a name; the click is caught here. It was Player Rankings' own, and
   needs that page's whole list for its ranks, so the list is built here, the first time a card
   opens (most of it the page already loaded), and Rankings reads the same list.
   It's its own layer rather than Vault.popup, so a name inside Trade Coach or another pop-up
   opens on top, and closing it leaves what's underneath as it was. */
(function () {
  const fmtInt = Vault.fmtInt, fmtFloat = Vault.fmtFloat;
  const fmtSigned = n => Number.isFinite(n) ? Vault.signed(n, x => x.toFixed(1)) : '—';
  const ppgTone = (r, n) => r <= Math.ceil(n * 0.2) ? 'bg-emerald-400/30 text-emerald-50' : r <= Math.ceil(n * 0.4) ? 'bg-emerald-400/15 text-emerald-100'
    : r > n - Math.ceil(n * 0.2) ? 'bg-rose-500/30 text-rose-50' : r > n - Math.ceil(n * 0.4) ? 'bg-rose-500/15 text-rose-100' : 'bg-amber-400/15 text-amber-100';
  const posColor = pos => `pos-badge-${['QB','RB','WR','TE'].includes(pos) ? pos : 'default'}`;
  let isSF = true, leagueObj = null, scoringSettings = null, rosterPositions = [], teamCount = 10;
  let allRows = [], trendWindowDays = 90, loading = null;

  // Official primary/secondary brand colors, keyed by Sleeper's canonical team
  // abbreviation (also what its logo CDN uses). Public team-identity facts, not
  // scraped or copyrighted assets.
  const TEAM_COLORS = {
    ARI: ['#97233F', '#000000'], ATL: ['#A71930', '#000000'], BAL: ['#241773', '#000000'], BUF: ['#00338D', '#C60C30'],
    CAR: ['#0085CA', '#101820'], CHI: ['#0B162A', '#C83803'], CIN: ['#FB4F14', '#000000'], CLE: ['#311D00', '#FF3C00'],
    DAL: ['#003594', '#041E42'], DEN: ['#FB4F14', '#002244'], DET: ['#0076B6', '#B0B7BC'], GB: ['#203731', '#FFB612'],
    HOU: ['#03202F', '#A71930'], IND: ['#002C5F', '#A2AAAD'], JAX: ['#101820', '#D7A22A'], KC: ['#E31837', '#FFB81C'],
    LAC: ['#0080C6', '#FFC20E'], LAR: ['#003594', '#FFA300'], LV: ['#000000', '#A5ACAF'], MIA: ['#008E97', '#FC4C02'],
    MIN: ['#4F2683', '#FFC62F'], NE: ['#002244', '#C60C30'], NO: ['#D3BC8D', '#101820'], NYG: ['#0B2265', '#A71930'],
    NYJ: ['#125740', '#000000'], PHI: ['#004C54', '#A5ACAF'], PIT: ['#FFB612', '#101820'], SF: ['#AA0000', '#B3995D'],
    SEA: ['#002244', '#69BE28'], TB: ['#D50A0A', '#34302B'], TEN: ['#4B92DB', '#002244'], WAS: ['#5A1414', '#FFB612'],
    OAK: ['#000000', '#A5ACAF']
  };
  // KTC scrapes its own team codes for a handful of franchises; normalize onto
  // Sleeper's canonical abbreviations, which both TEAM_COLORS and the logo CDN use.
  const TEAM_ALIAS = { GBP: 'GB', JAC: 'JAX', KCC: 'KC', LVR: 'LV', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB' };
  function teamMeta(team) {
    if (!team || team === 'FA') return null;
    const code = TEAM_ALIAS[team] || team;
    const colors = TEAM_COLORS[code];
    if (!colors) return null;
    return { code, primary: colors[0], secondary: colors[1], logo: `https://sleepercdn.com/images/team_logos/nfl/${code.toLowerCase()}.png` };
  }

  // Builds { norm -> [{date, value, ppg}, ...] } across every daily snapshot.
  // data/player-value-history.json is universal (every player KTC ranks, not just
  // this league's roster) and stores raw sf/oneQB/tep/tepp price fields plus raw
  // projected stats — resolved here to THIS league's real format/TEP/scoring
  // settings, same as every other value/PPG number on this page.
  function buildTrendMap(history, isSFLeague, scoring) {
    const map = new Map();
    (history.snapshots || []).forEach(snap => {
      Object.entries(snap.players || {}).forEach(([norm, entry]) => {
        if (!map.has(norm)) map.set(norm, []);
        const value = Vault.resolveHistoricalValue(entry, isSFLeague, scoring?.bonus_rec_te);
        const ppg = entry.stats ? Vault.playerSeasonPpg(entry.stats, scoring) : null;
        map.get(norm).push({ date: snap.date, value, ppg, estimated: !!snap.estimated });
      });
    });
    return map;
  }

  // Recomputes each row's windowed trend series (and the sparkline/delta/modal
  // charts derived from it) from the full trendSeries every row already
  // carries — called once on load and again whenever the window toggle
  // changes, so nothing needs re-fetching.
  function applyTrendWindow() {
    const cutoff = trendWindowDays === Infinity ? null : Date.now() - trendWindowDays * 24 * 60 * 60 * 1000;
    allRows.forEach(r => {
      const windowed = cutoff == null ? r.trendSeries : r.trendSeries.filter(pt => new Date(pt.date).getTime() >= cutoff);
      // Filtered to dates that actually resolved a finite value — a day this
      // player has projected-stat data (ppg) but no KTC price yet, or vice versa,
      // can land a null in either field.
      const values = windowed.map(pt => pt.value).filter(Number.isFinite);
      r.windowedSeries = windowed;
      r.trendValues = values;
      r.trendDelta = values.length >= 2 ? values[values.length - 1] - values[0] : null;
    });
  }

  const outTip = r => (r.bench
    ? `Projected to play ${r.gamesLeft ? `only ${r.gamesLeft} of the ${r.weeksLeft}` : `none of the ${r.weeksLeft}`} weeks left. Projected ${fmtFloat(r.healthyPpg, 1)} a game when playing`
    : `${Vault.escapeHtml(r.out)}${r.healthyPpg ? `. Projected ${fmtFloat(r.healthyPpg, 1)} a game when healthy` : ''}`);

  // Shared hover machinery for playerChart (see wireChartHover, set up once at
  // page init) — each chart registers its series + coordinate mapping here
  // under a unique id so one delegated mousemove listener can serve every
  // chart on the page, including ones inside a modal that gets re-rendered
  // from scratch each time it opens.
  let chartRegistrySeq = 0;
  const chartRegistry = new Map();

  // market: Map(date -> { value, n }) for the dots; trend: Map(date -> value) for the 30-day line.
  function playerChart(rawSeries, field = 'value', decimals = 0, market = null, trend = null) {
    // Drawn narrower on phones, so the scaled-down text stays readable (~10px, not ~6px).
    const narrow = window.innerWidth < 640, FS = narrow ? 11 : 9;
    const W = narrow ? 320 : 460, H = narrow ? 160 : 150, ML = 48, MR = 12, MT = 10, MB = narrow ? 24 : 22;
    const plotW = W - ML - MR, plotH = H - MT - MB;
    // Not every date has every field — the value backfill (KTC) covers years
    // densely, but PPG only ever gets a real number on days something actually
    // recorded it (a season boundary, or a live daily snapshot), so most
    // backfilled days have no ppg at all. Plotting a field means only the points
    // that actually HAVE it, not the raw shared date grid — a hole doesn't
    // corrupt the whole scale into NaN.
    const series = rawSeries.filter(p => Number.isFinite(p[field]));
    if (series.length < 1) return `<div class="text-[12px] text-zinc-400 py-6 text-center">Not enough data yet.</div>`;
    const vals = series.map(p => p[field]);
    const mVals = [...(market ? series.map(p => market.get(p.date)?.value) : []), ...(trend ? series.map(p => trend.get(p.date)) : [])].filter(Number.isFinite);
    const minV = Math.min(...vals, ...mVals), maxV = Math.max(...vals, ...mVals);
    const pad = (maxV - minV) * 0.1 || maxV * 0.1 || (decimals ? 1 : 100);
    const yMin = Math.max(0, minV - pad), yMax = maxV + pad;
    const x = i => ML + (series.length > 1 ? i / (series.length - 1) * plotW : 0);
    const y = v => MT + plotH - (v - yMin) / (yMax - yMin) * plotH;
    const fmt = v => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const pts = series.map((p, i) => `${x(i)},${y(p[field])}`).join(' ');
    // A lone day-1 point still needs to be visible even though there's no line to
    // draw yet — a dot per point confirms tracking has actually started. An
    // estimated day (interpolated over a real data outage — see the `estimated`
    // flag buildTrendMap carries through from the snapshot) draws hollow instead
    // of filled, so the line stays continuous without passing off a guess as real.
    const trendColor = vals[vals.length - 1] >= vals[0] ? '#34d399' : '#f87171';
    const dots = series.map((p, i) => p.estimated
      ? `<circle cx="${x(i)}" cy="${y(p[field])}" r="3" fill="none" stroke="${trendColor}" stroke-width="1.25" stroke-dasharray="1.5 1.5"><title>${p.date}: estimated (data outage)</title></circle>`
      : `<circle cx="${x(i)}" cy="${y(p[field])}" r="2.5" fill="${trendColor}"><title>${p.date}</title></circle>`).join('');
    const gridLines = [0, 0.5, 1].map(f => {
      const v = yMin + (yMax - yMin) * f, yy = y(v);
      return `<line x1="${ML}" y1="${yy}" x2="${W - MR}" y2="${yy}" stroke="currentColor" class="text-white/5"/>
        <text x="${ML - 6}" y="${yy + 3}" text-anchor="end" font-size="${FS}" fill="currentColor" class="text-zinc-400">${fmt(v)}</text>`;
    }).join('');
    const dateTicks = (series.length === 1 ? [0] : [0, series.length - 1]).map(i =>
      `<text x="${x(i)}" y="${H - 6}" text-anchor="${series.length === 1 ? 'middle' : i === 0 ? 'start' : 'end'}" font-size="${FS}" fill="currentColor" class="text-zinc-400">${series[i].date}</text>`
    ).join('');
    const up = vals[vals.length - 1] >= vals[0];

    const chartId = `pc${chartRegistrySeq++}`;
    chartRegistry.set(chartId, { series, field, decimals, ML, MT, plotW, plotH, W, H, label: field === 'ppg' ? 'PPG' : market ? 'KTC' : 'Value', market });
    // Market points: one per day with completed trades (bigger with more trades), joined faintly.
    let marketLines = '';
    if (market) {
      const pts = series.map((p, i) => [i, market.get(p.date)]).filter(([, m]) => m && Number.isFinite(m.value));
      // Faint joins only between trade days within a week of each other, so a gap never reads as a trend.
      // The 30-day trend through the dots when there's enough to draw one, else faint joins between nearby dots.
      const runs = [[]];
      if (trend) series.forEach((p, i) => { const v = trend.get(p.date); if (Number.isFinite(v)) runs[runs.length - 1].push(`${x(i)},${y(v)}`); else if (runs[runs.length - 1].length) runs.push([]); });
      const trendLine = runs.filter(r => r.length > 1).map(r => `<polyline points="${r.join(' ')}" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
      marketLines = (trendLine || pts.slice(1).map(([i, m], k) => { const [j, prev] = pts[k]; return i - j <= 7 ? `<line x1="${x(j)}" y1="${y(prev.value)}" x2="${x(i)}" y2="${y(m.value)}" stroke="#fbbf24" stroke-opacity="0.35" stroke-width="1.25"/>` : ''; }).join(''))
        + pts.map(([i, m]) => `<circle cx="${x(i)}" cy="${y(m.value)}" r="${Math.min(5, 2.5 + Math.log2(m.n))}" fill="#fbbf24" stroke="#0c0d10" stroke-width="1"/>`).join('');
    }
    // A transparent rect over the whole plot area catches mousemove anywhere
    // in the chart, not just exactly on a 2.5px-radius circle.
    const hoverRect = `<rect x="${ML}" y="${MT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair"/>`;
    const legend = market ? `<div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400 mt-1"><span class="inline-flex items-center gap-1.5"><span class="w-3 h-0.5 rounded ${up ? 'bg-emerald-400' : 'bg-rose-400'}"></span>KTC value</span><span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full bg-amber-400"></span>What managers paid for him that day</span>${trend && trend.size ? '<span class="inline-flex items-center gap-1.5"><span class="w-3 h-0.5 rounded bg-amber-400"></span>Market price (what trade value used)</span>' : ''}</div>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" data-chart-id="${chartId}">${gridLines}<polyline points="${pts}" fill="none" stroke="${up ? '#34d399' : '#f87171'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${marketLines}${hoverRect}${dateTicks}</svg>${legend}`;
  }

  // One delegated listener serves every chart, including ones re-rendered
  // fresh each time the modal opens — no per-render re-wiring needed. Shows a
  // small floating tooltip plus a vertical guide line snapped to the nearest
  // real data point, so hovering anywhere near a value can be matched back to
  // the exact date something happened (a trade, a draft, a news hit).
  function wireChartHover() {
    const tooltip = document.createElement('div');
    tooltip.id = 'chartTooltip';
    tooltip.className = 'hidden fixed z-[70] pointer-events-none bg-black/90 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-zinc-200 shadow-lg whitespace-nowrap';
    document.body.appendChild(tooltip);
    let guideEl = null;

    function clear() {
      tooltip.classList.add('hidden');
      if (guideEl) { guideEl.remove(); guideEl = null; }
    }

    document.addEventListener('mousemove', e => {
      const svg = e.target.closest('svg[data-chart-id]');
      if (!svg) { clear(); return; }
      const info = chartRegistry.get(svg.dataset.chartId);
      if (!info || !info.series.length) { clear(); return; }
      const rect = svg.getBoundingClientRect();
      const svgX = (e.clientX - rect.left) / rect.width * info.W;
      const { series, ML, plotW } = info;
      const frac = series.length > 1 ? Math.max(0, Math.min(1, (svgX - ML) / plotW)) : 0;
      const idx = Math.round(frac * (series.length - 1));
      const p = series[idx];
      if (!p) { clear(); return; }

      guideEl?.remove();
      const guideX = ML + (series.length > 1 ? idx / (series.length - 1) * plotW : 0);
      guideEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      guideEl.setAttribute('x1', guideX); guideEl.setAttribute('x2', guideX);
      guideEl.setAttribute('y1', info.MT); guideEl.setAttribute('y2', info.MT + info.plotH);
      guideEl.setAttribute('stroke', 'currentColor');
      guideEl.setAttribute('class', 'text-white/25');
      guideEl.setAttribute('stroke-dasharray', '2 2');
      svg.appendChild(guideEl);

      const fmt = v => v.toLocaleString(undefined, { minimumFractionDigits: info.decimals, maximumFractionDigits: info.decimals });
      const mv = info.market && info.market.get(p.date);
      tooltip.innerHTML = `<div class="text-zinc-400">${p.date}${p.estimated ? ' (estimated)' : ''}</div><div class="font-semibold mono">${info.label}: ${fmt(p[info.field])}</div>${mv ? `<div class="font-semibold mono text-amber-300">Market: ${fmt(mv.value)} <span class="font-normal text-zinc-400">(${mv.n} trade${mv.n === 1 ? '' : 's'})</span></div>` : ''}`;
      tooltip.classList.remove('hidden');
      // Flip to the other side of the cursor when it would run off the window.
      const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
      tooltip.style.left = `${e.clientX + 14 + tw <= innerWidth - 8 ? e.clientX + 14 : Math.max(8, e.clientX - 14 - tw)}px`;
      tooltip.style.top = `${e.clientY + 14 + th <= innerHeight - 8 ? e.clientY + 14 : Math.max(8, e.clientY - 14 - th)}px`;
    });
    document.addEventListener('mouseleave', clear);
  }
  wireChartHover();

  function renderPlayerCard(r) {
    const tm = teamMeta(r.team);
    const noHistory = `<div class="text-[12px] text-zinc-400 py-6 text-center">No price history yet for this player.</div>`;
    const valueChart = r.windowedSeries.length >= 1 ? playerChart(r.windowedSeries, 'value', 0) : noHistory;
    const ppgChart = r.windowedSeries.length >= 1 ? playerChart(r.windowedSeries, 'ppg', 1) : noHistory;

    let seasonRows = '';
    if (r.seasonHistory) {
      const seasons = Object.keys(r.seasonHistory).sort((a, b) => b - a);
      seasonRows = seasons.map(yr => {
        const s = r.seasonHistory[yr];
        return `<tr>
          <td class="py-1.5 text-zinc-400">${yr}${+yr === +leagueObj?.season ? ' so far' : ''}</td>
          <td class="py-1.5 text-right mono text-zinc-200">${fmtFloat(s.points, 1)}</td>
          <td class="py-1.5 text-right mono text-zinc-400">${fmtFloat(s.ppg, 1)}</td>
          <td class="py-1.5 text-right mono text-zinc-400">${s.gp}</td>
          <td class="py-1.5 text-right mono text-zinc-300">#${s.posRank}</td>
          <td class="py-1.5 text-right mono text-zinc-400">#${s.overallRank}</td>
        </tr>`;
      }).join('');
    }
    const historySection = seasonRows ? `
      <div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-4 mb-2">Season History <span class="text-zinc-400 normal-case">— scored to your league's settings</span></div>
      <table class="w-full text-[12px]">
        <thead><tr class="text-[11px] text-zinc-400 uppercase tracking-wider">
          <th class="text-left font-medium pb-1">Season</th>
          <th class="text-right font-medium pb-1">Points</th>
          <th class="text-right font-medium pb-1">PPG</th>
          <th class="text-right font-medium pb-1">GP</th>
          <th class="text-right font-medium pb-1">${r.pos || 'Pos'} Rank</th>
          <th class="text-right font-medium pb-1">Overall</th>
        </tr></thead>
        <tbody class="divide-y divide-white/5">${seasonRows}</tbody>
      </table>` : '';

    return `
      <div class="flex items-start justify-between gap-3 mb-4 pr-6 -mx-6 -mt-6 px-6 pt-6 pb-4 rounded-t-[19px]"
           style="background:${tm ? `linear-gradient(135deg, ${tm.primary}30, transparent 75%)` : 'none'}; border-bottom:1px solid ${tm ? tm.primary + '40' : 'transparent'};">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative shrink-0">
            <img src="${r.pid ? `https://sleepercdn.com/content/nfl/players/${r.pid}.jpg` : 'https://sleepercdn.com/images/v2/icons/player_default.webp'}"
                 alt="${Vault.escapeHtml(r.player)}" class="size-14 rounded-full object-cover bg-white/5 border-2"
                 style="border-color:${tm ? tm.primary : 'rgba(255,255,255,.1)'}"
                 onerror="this.onerror=null; this.src='https://sleepercdn.com/images/v2/icons/player_default.webp';"/>
            ${tm ? `<img src="${tm.logo}" alt="${Vault.escapeHtml(tm.code)}" class="absolute -bottom-1 -right-1 size-6 rounded-full bg-black object-contain ring-2 ring-black" onerror="this.remove()"/>` : ''}
          </div>
          <div class="min-w-0">
            <div class="text-[20px] font-bold text-zinc-100 truncate">${Vault.escapeHtml(r.player)}</div>
            <div class="text-[12px] text-zinc-400 mt-1">${Vault.escapeHtml(r.team) || '—'} • Age ${r.age != null ? fmtFloat(r.age, 1) : '—'}${r.yearsExp != null ? ' • ' + (r.yearsExp === 0 ? 'Rookie' : `${r.yearsExp} yr${r.yearsExp === 1 ? '' : 's'} in NFL`) : ''}</div>
          </div>
        </div>
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border shrink-0 mr-6 ${posColor(r.pos)}">${r.pos || '—'}</span>
      </div>
      <div class="flex flex-wrap gap-2 mb-3">${cardActions(r)}</div>
      <div id="pcHolder" class="text-[12px] text-zinc-400 mb-3 empty:hidden"></div>
      <div class="grid grid-cols-4 gap-2 text-center py-3 border-y border-white/10 mb-4">
        <div><div class="mono text-[15px] text-zinc-100">${fmtInt(r.value)}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5"><span data-term="value">Value</span></div></div>
        <div><div class="mono text-[15px] text-zinc-100">${r.posRank ? '#' + r.posRank + ' of ' + r.posCount : '—'}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">${r.pos || 'Pos'} Rank</div></div>
        <div><div class="mono text-[15px] ${r.out ? 'text-rose-300' : r.bench ? 'text-zinc-500' : 'text-zinc-100'}"${r.out || r.bench ? ` title="${outTip(r)}"` : ''}>${r.out ? 'Out' : r.bench ? 'Bench' : fmtFloat(r.ppg, 2)}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5"><span data-term="projPpg">PPG</span></div></div>
        <div><div class="mono text-[15px] ${r.vorp != null && r.vorp >= 0 ? 'text-emerald-400' : r.vorp != null ? 'text-rose-400' : 'text-zinc-100'}">${fmtSigned(r.vorp)}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5"><span data-term="vorp">VORP</span></div></div>
      </div>
      ${injuryHtml(r)}
      ${playoffHtml(r)}
      <div id="pcWeekly" class="mb-4"></div>
      <div id="pcMarket" class="mb-4"></div>
      <div id="pcTrades" class="mb-4 empty:hidden"></div>
      <div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-2">Value Over Time${Vault.info('valueOverTime')}</div>
      <div id="pcValueChart">${valueChart}</div>
      <div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-4 mb-2">PPG Over Time${Vault.info('ppgOverTime')}</div>
      ${ppgChart}
      ${historySection}
    `;
  }

  // From the card, straight to what you'd do next (user, 2026-11-05).
  function cardActions(r) {
    const link = (href, text) => `<a href="${href}" class="text-[12px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25">${text}</a>`;
    const name = encodeURIComponent(r.norm);
    return [r.pid ? link(`${Vault.linkTo('trade.html')}&coach=player&player=p_${r.pid}`, 'Build a trade') : '',
      link(`${Vault.linkTo('market.html')}&p=${name}`, 'Market page'),
      link(`${Vault.linkTo('compare.html')}&p=${name}`, 'Compare')].join('');
  }
  // His projection in each playoff week: byes and injuries show, which the season average hides.
  function playoffHtml(r) {
    if (!r.playoff?.length) return '';
    const cell = w => `<div><div class="mono text-[15px] ${w.pts == null ? 'text-zinc-500' : 'text-zinc-100'}">${w.pts == null ? 'Out' : w.pts.toFixed(1)}</div><div class="text-[11px] text-zinc-400 mt-0.5">Week ${w.week}</div></div>`;
    return `<div class="rounded-xl border border-white/10 bg-black/20 p-3.5 mb-4">
        <div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-2">Playoff weeks${Vault.info('playoffWeeks')} <span class="normal-case tracking-normal text-zinc-500">· projected points</span></div>
        <div class="grid gap-2 text-center" style="grid-template-columns:repeat(${r.playoff.length},minmax(0,1fr))">${r.playoff.map(cell).join('')}</div>
      </div>`;
  }
  // What he really scored each week, in this league's scoring. Loaded with the first card.
  let weeklyLoad = null;
  // Who holds him in this league (user's list, 2026-11-05). Sleeper's rosters, so it works before the page's teams are built.
  function renderHolder(r) {
    const box = document.getElementById('pcHolder'), id = leagueObj?.league_id;
    if (!box || !r.pid || !id) return;
    const url = what => `https://api.sleeper.app/v1/league/${id}/${what}`;
    Promise.all([Vault.sleeperJson(url('rosters'), 5), Vault.sleeperJson(url('users'), 5)]).then(([rosters, users]) => {
      if (document.getElementById('pcHolder') !== box) return;
      const held = rosters.find(x => (x.players || []).includes(String(r.pid)));
      if (!held) { box.textContent = 'Free agent in your league'; return; }
      if (String(held.roster_id) === String(Vault.getMyTeamId(id))) { box.textContent = 'On your team'; return; }
      const u = users.find(x => x.user_id === held.owner_id);
      box.innerHTML = `On ${Vault.teamLink({ rosterId: held.roster_id, teamName: Vault.teamLabel(u, held.roster_id) })}`;
    }).catch(() => {});
  }
  const loadWeekly = () => (weeklyLoad ||= fetch(`data/weekly/${leagueObj?.season}.json`).then(res => (res.ok ? res.json() : null)).catch(() => null));
  function boomBust(played, r) {
    if (played.length < 3) return '';
    const pts = played.map(w => w.pts), line = Number.isFinite(r.ppg) && Number.isFinite(r.vorp) ? r.ppg - r.vorp : null;
    const stat = (v, label) => `<div><div class="mono text-[14px] text-zinc-100">${v}</div><div class="text-[11px] text-zinc-400 mt-0.5">${label}</div></div>`;
    return `<div class="grid grid-cols-3 gap-2 text-center mt-2">${stat(Math.max(...pts).toFixed(1), 'Best')}${stat(Math.min(...pts).toFixed(1), 'Worst')}${line != null ? stat(`${pts.filter(p => p > line).length} of ${pts.length}`, Vault.term('starterLine', 'Over a starter')) : ''}</div>`;
  }
  function renderWeekly(r) {
    const box = document.getElementById('pcWeekly');
    if (!box || !r.pid || !leagueObj) return;
    loadWeekly().then(file => {
      const pl = file?.players?.[r.pid], snaps = file?.keys.indexOf('off_snp') ?? -1;
      if (!pl || document.getElementById('pcWeekly') !== box) return;
      const last = Math.max(...Object.values(file.players).flatMap(p => Object.keys(p.w).map(Number)));
      const weeks = Array.from({ length: last }, (_, i) => {
        const week = i + 1, row = pl.w[week];
        if (!row) return { week };
        const st = {}; file.keys.forEach((k, j) => { st[k] = row[j + 3]; });
        return { week, opp: row[1], pts: Vault.scoreStats(st, scoringSettings), played: row[snaps + 3] > 0 || st.gp > 0 };
      });
      const played = weeks.filter(w => w.played);
      if (!played.length) return;
      const avg = l => l.reduce((s, w) => s + w.pts, 0) / l.length, recent = played.slice(-4);
      const W = 460, H = 96, B = 16, T = 12, max = Math.max(...played.map(w => w.pts), 1), step = W / weeks.length, y = v => T + (1 - v / max) * (H - B - T);
      const bars = weeks.map((w, i) => {
        const x = i * step + step / 2, label = `<text x="${x}" y="${H - 3}" text-anchor="middle" font-size="9" fill="currentColor" class="text-zinc-500">${w.week}</text>`;
        if (!w.played) return `<g><title>Week ${w.week}: didn't play</title><rect x="${x - 3}" y="${H - B - 2}" width="6" height="2" fill="currentColor" class="text-zinc-600"/>${label}</g>`;
        const on = recent.includes(w), top = y(Math.max(w.pts, 0));
        return `<g><title>Week ${w.week}${w.opp ? ` vs ${Vault.escapeHtml(w.opp)}` : ''}: ${w.pts.toFixed(1)} points</title><rect x="${i * step}" y="0" width="${step}" height="${H}" fill="transparent"/><rect x="${x - 7}" y="${top}" width="14" height="${Math.max(1, H - B - top)}" rx="2" fill="#fbbf24" opacity="${on ? 1 : 0.45}"/>${w.pts === Math.max(...played.map(p => p.pts)) || w === played[played.length - 1] ? `<text x="${x}" y="${top - 3}" text-anchor="middle" font-size="9" fill="currentColor" class="text-zinc-300">${w.pts.toFixed(1)}</text>` : ''}${label}</g>`;
      }).join('');
      box.innerHTML = `<div class="flex items-baseline justify-between gap-3 mb-2"><div class="text-[11px] text-zinc-400 uppercase tracking-wider whitespace-nowrap shrink-0">Points by week${Vault.info('pointsByWeek')}</div><div class="text-[12px] text-zinc-400">${recent.length > 1 ? `Last ${recent.length}: <span class="mono text-zinc-200">${avg(recent).toFixed(1)}</span> · ` : ''}Season: <span class="mono text-zinc-200">${avg(played).toFixed(1)}</span> a game</div></div>
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="${Vault.escapeHtml(r.player)}'s points each week this season">${bars}</svg>${boomBust(played, r)}`;
    });
  }

  // Injured or questionable: the same details as the tag's hover card (user, 2026-11-05).
  function injuryHtml(r) {
    const tag = r.inj && Vault.injuryTag(r.inj, r.inj.weeks);
    if (!tag) return '';
    return `<div class="rounded-xl border border-white/10 bg-black/20 p-3.5 mb-4 text-[12px]">
        <div class="flex items-center justify-between gap-3 mb-2"><span class="text-[11px] text-zinc-400 uppercase tracking-wider">Injury</span><span class="text-[11px] px-1 py-px rounded border ${tag.cls} whitespace-nowrap">${tag.text}</span></div>
        ${Vault.injuryRows(r.inj, r.inj.weeks)}
      </div>`;
  }

  /* KTC value vs market value: what managers actually paid for him in real
     trades where he was the main piece (market-data.js), from leagues as much
     like this one as there are enough of. Shown as his KTC value scaled by the
     typical premium or discount, with the usual range. */
  // Each player's daily market line (scripts/summarize-sleeper-trades.js), loaded once.
  let dailyMarketLoading = null;
  function loadDailyMarket() {
    if (!dailyMarketLoading) {
      const qbs = Vault.tradeFormatSig(leagueObj).qbs;
      dailyMarketLoading = fetchMarketDaily(qbs, { league: leagueObj }); // last ~400 days by day, older by month, and the grade's prices (market-data.js)
    }
    return dailyMarketLoading;
  }
  function renderRecentTrades(r) {
    const box = document.getElementById('pcTrades'), { like, pool } = marketPool(leagueObj, r.player);
    if (!box || !like || !pool.length) return;
    const name = a => Vault.escapeHtml(a.type === 'pick' ? Vault.pickName(a) : a.name);
    const side = (s, him) => [...s].sort((x, y) => y.value - x.value).map(a => `<span class="${a === him ? 'text-zinc-100 font-medium' : 'text-zinc-300'}">${name(a)}</span>`).join('<span class="text-zinc-600">, </span>');
    const rows = [...pool].sort((a, b) => b.t.date.localeCompare(a.t.date)).slice(0, 3).map(c => {
      const p = marketPremium(c);
      return `<div class="py-2 border-t border-white/5 flex items-start gap-3">
        <div class="min-w-0 flex-1"><div class="text-[11px] text-zinc-500">${new Date(c.t.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div class="flex text-[12px] mt-0.5 leading-relaxed"><span class="text-zinc-500 w-9 shrink-0">Got</span><span class="min-w-0">${side(c.ps, c.him)}</span></div>
          <div class="flex text-[12px] leading-relaxed"><span class="text-zinc-500 w-9 shrink-0">Sent</span><span class="min-w-0">${side(c.os, null)}</span></div></div>
        <div class="text-right shrink-0"><div class="mono text-[13px] ${Math.abs(p) < 5 ? 'text-zinc-200' : p > 0 ? 'text-emerald-300' : 'text-orange-300'}">${Math.round(Math.abs(p))}% ${p > 0 ? 'over' : 'under'}</div><div class="text-[11px] text-zinc-500">paid vs KTC</div></div>
      </div>`;
    }).join('');
    box.innerHTML = `<div class="flex items-baseline justify-between gap-3 mb-1"><div class="text-[11px] text-zinc-400 uppercase tracking-wider">Recent trades${Vault.info('recentTrades')}</div><div class="text-[12px] text-zinc-500">${pool.length} in all</div></div>${rows}`;
  }
  function renderPlayerMarket(r) {
    const box = document.getElementById('pcMarket');
    if (!box || !leagueObj || !r.value) return;
    const shell = inner => `<div class="rounded-xl border border-white/10 bg-black/20 p-3.5">
        <div class="text-[11px] text-zinc-400 uppercase tracking-wider">Market value${Vault.info('market')} <span class="normal-case tracking-normal text-zinc-500">· what managers actually pay</span></div>${inner}</div>`;
    box.innerHTML = shell('<div class="text-[12px] text-zinc-500 mt-1.5">Checking completed trades…</div>');
    loadDailyMarket().then(daily => {
      const line = daily && daily.players[r.norm], chart = document.getElementById('pcValueChart');
      if (!line || !chart || document.getElementById('pcMarket') !== box || !r.windowedSeries.length) return;
      // His market value on a trade day = that day's KTC value with what managers paid over it that day.
      const prem = new Map(), start = new Date(daily.from + 'T00:00:00Z').getTime();
      line.forEach(([day, pct, n]) => prem.set(new Date(start + day * 864e5).toISOString().slice(0, 10), { pct, n }));
      const market = new Map();
      r.windowedSeries.forEach(p => { const m = prem.get(p.date); if (m && Number.isFinite(p.value)) market.set(p.date, { value: Math.round(p.value * (1 + m.pct / 100)), n: m.n }); });
      const pct = marketTrend(daily, r.norm, r.windowedSeries.map(p => p.date)), trend = new Map();
      r.windowedSeries.forEach(p => { if (pct.has(p.date) && Number.isFinite(p.value)) trend.set(p.date, Math.round(p.value * (1 + pct.get(p.date) / 100))); });
      if (market.size || trend.size) chart.innerHTML = playerChart(r.windowedSeries, 'value', 0, market, trend);
    });
    marketLoad(leagueObj).then(() => {
      if (document.getElementById('pcMarket') !== box) return; // a different card opened meanwhile
      renderRecentTrades(r);
      // His market value (market-data.js marketPlayer): the same number as the Player Market page and "At market prices".
      const mp = marketPlayer(leagueObj, r.player, r.pos), m = mp.read;
      // How easy he is to move: trades he was in lately, next to players at his position and value.
      const liq = marketLiquidityText(marketLiquidity(r.player, r.pos, r.value, allRows.map(x => ({ name: x.player, pos: x.pos, value: x.value }))), r.pos);
      const liqLine = liq ? `<div class="text-[12px] text-zinc-400 mt-2 leading-relaxed">${liq}</div>` : '';
      if (!m) {
        const n = marketValue(leagueObj, r.player).n;
        box.innerHTML = shell(`<div class="text-[12px] text-zinc-400 mt-1.5">Not enough completed trades with ${Vault.escapeHtml(r.player)} as the main piece yet${n ? ` (${n} so far)` : ''}. This fills in as The Vault collects more.</div>${liqLine}`);
        return;
      }
      const at = v => Math.round(r.value * (1 + v / 100)).toLocaleString();
      const pct = Math.round(mp.adj), peer = Math.round(marketPeerPct(mp) ?? 0), tone = Math.abs(peer) < 3 ? 'text-zinc-300' : peer > 0 ? 'text-emerald-300' : 'text-orange-300';
      const label = marketAdjText(mp), amount = label.replace(/ (over|under)$/, '');
      const read = Math.abs(pct) < 3 ? 'right about his KTC value' : `${amount} ${pct > 0 ? 'more' : 'less'} than KTC says`;
      box.innerHTML = shell(`
        <div class="flex items-baseline gap-3 flex-wrap mt-1">
          <span class="num text-[30px] text-zinc-100">${at(mp.adj)}${(Math.abs(m.premium) > MARKET_ADJ_CAP ? '+' : '')}</span>
          <span class="text-[13px] ${tone} cursor-help" title="${MARKET_PEER_TIP}">${marketPeerPhrase(mp)}</span><span class="text-[13px] text-zinc-500">KTC value ${fmtInt(r.value)}</span>
        </div>
        <div class="text-[12px] text-zinc-400 mt-1 leading-relaxed">Teams getting him paid ${read}, usually ${at(m.low)} to ${at(m.high)}. The price trade value uses: the median of every completed trade he headlined in your format over the last 45 days, counted the way trade value counts extra pieces; the range is from ${m.n} of those, in leagues like yours (${m.like}).</div>${liqLine}`);
    });
  }

  // A draft pick's card (2026-10-25): its price, its rank among picks and overall, and
  // its price over time (pick-value-history, same pricing as today).
  function renderPickCard(r) {
    const chart = r.windowedSeries.length >= 1 ? playerChart(r.windowedSeries, 'value', 0) : '<div class="text-[12px] text-zinc-400 py-6 text-center">No price history yet for this pick.</div>';
    const spread = r.ktcRaw != null && r.ktcRaw !== r.value;
    return `
      <div class="flex items-start justify-between gap-3 mb-4 pr-6">
        <div class="min-w-0">
          <div class="text-[20px] font-bold text-zinc-100">${Vault.escapeHtml(r.player)}</div>
          <div class="text-[12px] text-zinc-400 mt-1">Rookie draft pick · ${isSF ? 'Superflex' : '1QB'}</div>
        </div>
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border shrink-0 ${posColor(r.pos)}">PICK</span>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center py-3 border-y border-white/10 mb-4">
        <div><div class="mono text-[15px] text-zinc-100">${fmtInt(r.value)}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5"><span data-term="value">Value</span></div></div>
        <div><div class="mono text-[15px] text-zinc-100">#${r.posRank} of ${r.posCount}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">Among picks</div></div>
        <div><div class="mono text-[15px] text-zinc-100">#${r.overallRank}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">Overall</div></div>
      </div>
      ${spread ? `<p class="text-[12px] text-zinc-400 mb-4 leading-relaxed">KTC lists this pick at ${fmtInt(r.ktcRaw)}. The Vault prices early and late picks as the mid pick times what managers really pay for the difference (projected draft spots hold only so often), the same price the Trade Calculator uses.</p>` : ''}
      <div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-2">Value Over Time</div>
      ${chart}
    `;
  }

  // The PPG chart in a player's card is the only thing that reads the projected-stats history,
  // and it's 9MB, over half of what this page loaded (user, 2026-11-04). It loads with the
  // first card opened, then fills in every player's history and redraws that card.
  let statsLoad = null, cardOpen = null;
  function loadCardStats() {
    return (statsLoad ||= fetch('data/history/player-stats.json').then(res => (res.ok ? res.json() : null)).catch(() => null).then(stats => {
      if (!stats) { statsLoad = null; return; }
      allRows.forEach(r => {
        const byIdx = stats.players?.[r.norm];
        if (!byIdx) return;
        const at = new Map(r.trendSeries.map(pt => [pt.date, pt]));
        for (const [i, st] of Object.entries(byIdx)) {
          const date = stats.dates[+i], ppg = Vault.playerSeasonPpg(st, scoringSettings), pt = at.get(date);
          if (pt) pt.ppg = ppg;
          else r.trendSeries.push({ date, value: null, ppg, estimated: false });
        }
        r.trendSeries.sort((a, b) => a.date.localeCompare(b.date));
      });
      applyTrendWindow();
      if (cardOpen) drawCard(cardOpen);
    }));
  }

  // ---- The list every card reads ----
  async function build() {
    const [ktcData, projData, valueHistory, sleeperPlayers, playerHistory, pickHistory] = await Promise.all([
      Vault.fetchKtcValues(),
      Vault.fetchProjections(),
      Vault.fetchPlayerValueHistory(isSF, scoringSettings?.bonus_rec_te),
      Vault.fetchSleeperPlayers(),
      Vault.fetchPlayerHistory(),
      Vault.fetchPickValueHistory()
    ]);

    const ppgMap = Vault.buildProjectedPpgMapByName(projData, scoringSettings);

    const trendMap = buildTrendMap(valueHistory, isSF, scoringSettings);

    // Real per-season stats are stored RAW (data/player-history.json covers
    // every dynasty-relevant player, not just this league's roster) — scored to
    // THIS league's actual settings here, once, rather than trusting a number
    // baked in for a different league. Rank needs every player's score for that
    // season to be meaningful, so it's computed across the whole file, not
    // per-row.
    const seasonScored = new Map(); // "pid-year" -> {points, gp, posRank, overallRank}
    const seasonsByYear = new Map();
    Object.entries(playerHistory.players || {}).forEach(([pid, p]) => {
      Object.entries(p.seasons || {}).forEach(([year, stats]) => {
        if (!seasonsByYear.has(year)) seasonsByYear.set(year, []);
        seasonsByYear.get(year).push({ pid, pos: p.pos, points: Vault.scoreStats(stats, scoringSettings), gp: stats.gp || 0 });
      });
    });
    seasonsByYear.forEach((rows, year) => {
      [...rows].sort((a, b) => b.points - a.points).forEach((r, i) => { r.overallRank = i + 1; });
      ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
        rows.filter(r => r.pos === pos).sort((a, b) => b.points - a.points).forEach((r, i) => { r.posRank = i + 1; });
      });
      rows.forEach(r => seasonScored.set(`${r.pid}-${year}`, r));
    });

    // VORP (Value Over Replacement Player) — see Vault.computeReplacementLevels.
    // Same leaguewide lineup-fill buildLeagueTeams uses, computed independently
    // here since this page never calls buildLeagueTeams (it works off the full
    // KTC universe, not one league's rosters).
    const starterSlots = rosterPositions.filter(s => !['BN', 'IR', 'TAXI'].includes(s));
    const replacementLevels = Vault.computeReplacementLevels(ktcData, ppgMap, starterSlots, teamCount);

    const valueField = (isSF ? 'sf' : 'oneQB') + Vault.ktcTepSuffix(scoringSettings?.bonus_rec_te);
    // Injured with no game projected the rest of the way: "Out", not the points he'd
    // score healthy (user, 2026-11-04). Backups with no weekly projection aren't hurt,
    // so an injury tag has to be there too, and a coach's decision isn't an injury. Empty out of season, so nobody reads Out.
    const weeksLeft = String(projData.season) === String(leagueObj?.season)
      ? Array.from({ length: Math.max(0, 18 - (projData.fromWeek || 1)) }, (_, i) => (projData.fromWeek || 1) + i) : [];
    // A healthy player Sleeper has in at most two of the weeks left, and under half of
    // them, is a backup: his PPG is a rate for a game or two, which puts backup QBs at the
    // top of a sort (user, 2026-11-04). Half keeps starters in when few weeks are left.
    // No weekly projection at all means none of the weeks left.
    const playerRole = pid => {
      if (!weeksLeft.length) return {};
      const sp = sleeperPlayers?.[pid];
      const a = { ...Vault.injuryOf(sp), ...Vault.availOf(projData.players?.[pid], sp, undefined, weeksLeft) };
      const gamesLeft = a.avail ? weeksLeft.filter(w => Vault.availableIn(a, w)).length : 0;
      if (a.injury && a.avail && !gamesLeft && !/coach/i.test(a.injuryPart)) return { out: Vault.injuryText(a, weeksLeft) };
      if (gamesLeft > 2 || gamesLeft >= weeksLeft.length / 2 || VAULT_CONFIG.SIDELINED_STATUSES.includes(a.injury)) return {};
      return { bench: true, gamesLeft };
    };
    const rows = ktcData.players.map(p => {
      const norm = Vault.normalizeName(p.name);
      const value = p[valueField];
      const healthyPpg = ppgMap.get(norm) ?? null;
      const pid = Vault.findSleeperId(sleeperPlayers, p.name, p.pos, TEAM_ALIAS[p.team] || p.team); // NFL experience, photo and history are Sleeper's
      const { out, bench, gamesLeft } = healthyPpg == null ? {} : playerRole(pid);
      const ppg = out || bench ? null : healthyPpg;
      const vorp = Vault.vorp(ppg, p.pos, replacementLevels);
      // Full history — trendValues/trendDelta/windowedSeries (what's actually
      // displayed) get derived from this by applyTrendWindow() below, since
      // they depend on the current trend-window toggle, not just the data.
      const trendSeries = trendMap.get(norm) || [];
      const sp = sleeperPlayers?.[pid];
      const yearsExp = sp?.years_exp ?? null;
      const start = +leagueObj?.settings?.playoff_week_start || 15, playoffWeeks = weeksLeft.filter(w => w >= start && w < start + 3);
      const projected = healthyPpg != null && playoffWeeks.length ? { ppg: healthyPpg, ...Vault.availOf(projData.players?.[pid], sp, undefined, weeksLeft) } : null;
      const playoff = projected ? Vault.weekPpgs(projected, playoffWeeks).map((pts, i) => ({ week: playoffWeeks[i], pts })) : null;
      const inj = sp?.injury_status ? { name: p.name, weeks: weeksLeft, ...Vault.injuryOf(sp), ...Vault.availOf(projData.players?.[pid], sp, undefined, weeksLeft) } : null;
      const rawSeasons = pid ? playerHistory.players?.[pid]?.seasons : null;
      let seasonHistory = null;
      if (rawSeasons) {
        seasonHistory = {};
        Object.keys(rawSeasons).forEach(year => {
          const s = seasonScored.get(`${pid}-${year}`);
          if (!s) return;
          seasonHistory[year] = { points: +s.points.toFixed(1), ppg: s.gp ? +(s.points / s.gp).toFixed(2) : 0, gp: s.gp, posRank: s.posRank, overallRank: s.overallRank };
        });
        if (!Object.keys(seasonHistory).length) seasonHistory = null;
      }
      return { player: p.name, norm, inj, playoff, pos: p.pos, team: sp?.team || TEAM_ALIAS[p.team] || p.team, age: p.age, value, ppg, vorp, trendSeries, yearsExp, seasonHistory, pid, out, bench, gamesLeft, weeksLeft: weeksLeft.length, healthyPpg };
    });

    // Draft picks, ranked among the players (2026-10-25, user: "i want picks to be
    // included in rankings"): every year, round and early/mid/late KTC prices, at the
    // price the Trade Calculator uses (Vault.buildKtcPickMap: early and late are the
    // mid pick times the spread managers really pay), with that price's history.
    const tepBonus = scoringSettings?.bonus_rec_te;
    const pickYears = [...new Set((ktcData.picks || []).map(p => p.season))].sort();
    const pickMap = Vault.buildKtcPickMap(ktcData, isSF, pickYears, tepBonus);
    const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n] || 'th');
    const pickRows = [...pickMap].map(([key, value]) => {
      const [season, round, tier] = key.split('-'), raw = (ktcData.picks || []).find(p => `${p.season}-${p.round}-${p.slot}` === key);
      const trendSeries = (pickHistory.snapshots || []).map(s => ({ date: s.date, value: Vault.pickValueFromRow(s.picks, +season, +round, tier, isSF, tepBonus), ppg: null, estimated: !!s.estimated })).filter(p => Number.isFinite(p.value));
      return { player: `${season} ${tier[0].toUpperCase() + tier.slice(1)} ${ordinal(+round)}`, norm: `pick-${key}`, pos: 'PICK', team: '', age: null, value, ppg: null, vorp: null, trendSeries, isPick: true, ktcRaw: raw ? raw[valueField] : null };
    });

    allRows = [...rows.filter(r => r.value != null), ...pickRows];
    [...allRows].sort((a, b) => b.value - a.value).forEach((r, i) => { r.overallRank = i + 1; });
    applyTrendWindow();

    // Position rank — computed once here rather than per-render, since it only
    // depends on the full player pool, not the current filter/search/sort state.
    const byPos = new Map();
    allRows.forEach(r => { if (!byPos.has(r.pos)) byPos.set(r.pos, []); byPos.get(r.pos).push(r); });
    byPos.forEach(list => {
      list.sort((a, b) => b.value - a.value);
      list.forEach((r, i) => { r.posRank = i + 1; r.posCount = list.length; });
      const scored = list.filter(r => r.ppg > 0).sort((a, b) => b.ppg - a.ppg);
      scored.forEach((r, i) => { r.ppgRank = i + 1; r.ppgCount = scored.length; });
    });

    return allRows;
  }
  function load(cfg) {
    isSF = cfg.isSF; leagueObj = cfg.league; scoringSettings = cfg.scoring; rosterPositions = cfg.positions; teamCount = cfg.teams;
    return (loading = build());
  }
  // A page that isn't Rankings: read its league the way Rankings does.
  function ensure() {
    return loading ||= fetch(`https://api.sleeper.app/v1/league/${Vault.getLeagueId()}`).then(r => r.json()).catch(() => null).then(league => {
      const ok = league && !league.error;
      return load({ league: ok ? league : null, isSF: ok ? Vault.isSuperflex(league) : true, scoring: ok ? league.scoring_settings || {} : {}, positions: ok ? league.roster_positions || [] : [], teams: ok ? league.total_rosters || 10 : 10 });
    }).catch(e => { loading = null; throw e; });
  }

  // ---- The layer ----
  let box = null, returnTo = null, wasLocked = false, leaving = false;
  const body = () => box.querySelector('#playerCardBody');
  const isOpen = () => !!box && !box.classList.contains('hidden');
  function shell() {
    box = document.createElement('div');
    box.className = 'hidden fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-center justify-center sm:p-4';
    box.innerHTML = `<div class="glass max-w-lg w-full p-6 relative h-[100dvh] sm:h-auto sm:max-h-[85vh] overflow-y-auto" role="dialog" aria-modal="true" aria-label="Player card">
        <button id="playerCardClose" aria-label="Close player card" class="absolute top-3 right-3 size-8 z-10 grid place-items-center rounded-lg text-zinc-400 hover:text-white text-[20px] leading-none">×</button>
        <div id="playerCardBody"></div>
      </div>`;
    document.body.append(box);
    box.querySelector('#playerCardClose').onclick = close;
    box.addEventListener('click', e => { if (e.target === box) close(); });
    // Capture, so Esc and Tab reach this card and not Trade Coach or a pop-up under it.
    document.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); return close(); }
      if (e.key !== 'Tab') return;
      e.stopImmediatePropagation();
      const f = [...box.querySelectorAll('button, a[href], select, input, [tabindex="0"]')].filter(x => x.offsetParent);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }, true);
  }
  // Back closes the card, and only the card: it's a full-screen page on a phone (vault-core.js calls this first).
  Vault._cardPop = () => {
    if (leaving) { leaving = false; return true; }
    if (isOpen()) { hide(); return true; }
    return false;
  };
  function hide() {
    cardOpen = null;
    box.classList.add('hidden');
    if (!wasLocked) Vault.pageLock(false);
    if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    returnTo = null;
  }
  function close() { if (!isOpen()) return; hide(); leaving = true; history.back(); }
  function show() {
    if (!box) shell();
    if (isOpen()) return;
    returnTo = document.activeElement;
    wasLocked = document.documentElement.classList.contains('overflow-hidden');
    if (!wasLocked) Vault.pageLock(true);
    box.classList.remove('hidden');
    history.pushState({ vaultCard: true }, '');
    box.querySelector('#playerCardClose').focus({ preventScroll: true });
  }
  function drawCard(r) {
    body().innerHTML = r.isPick ? renderPickCard(r) : renderPlayerCard(r);
    box.firstElementChild.scrollTop = 0;
    if (!r.isPick) { renderPlayerMarket(r); renderWeekly(r); renderHolder(r); }
  }
  async function open(norm, name = '') {
    show();
    const want = norm;
    cardOpen = want;
    body().innerHTML = '<div class="text-[13px] text-zinc-400 py-16 text-center">Loading the player card…</div>';
    try {
      await ensure();
    } catch {
      if (cardOpen === want) body().innerHTML = '<div class="text-[13px] text-zinc-400 py-16 text-center">The player card couldn\'t load. Try again in a moment.</div>';
      return;
    }
    if (cardOpen !== want) return; // closed, or another card opened meanwhile
    const r = allRows.find(x => x.norm === norm);
    if (!r) {
      body().innerHTML = `<div class="text-[13px] text-zinc-400 py-16 text-center">${Vault.escapeHtml(name || 'This player')} isn't in KTC's rankings, so there's no card yet.</div>`;
      return;
    }
    cardOpen = r;
    drawCard(r);
    if (!r.isPick) loadCardStats();
  }
  // The team card: the standing, the shape of the roster, and where to go next (user, 2026-11-05).
  let teamsLoad = null;
  const leagueTeams = () => (typeof teams !== 'undefined' && teams?.length && teams[0].plist ? Promise.resolve(teams)
    : (teamsLoad ||= Vault.buildLeagueTeams(Vault.getLeagueId()).then(b => b.teams).catch(e => { teamsLoad = null; throw e; })));
  function teamCardHtml(t, all) {
    const rank = all.filter(x => x.overall > t.overall).length + 1, ppg = [...all].sort((a, b) => b.opt - a.opt).indexOf(t) + 1, p = t.projected;
    const stat = (v, label) => `<div><div class="mono text-[15px] text-zinc-100">${v}</div><div class="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">${label}</div></div>`;
    const pct = v => (v == null ? '—' : `${v > 0 && v < 1 ? '<1' : v > 99 && v < 100 ? '>99' : Math.round(v)}%`);
    const needs = Vault.positionalProfile(t, all).needs.map(x => x.toUpperCase());
    const best = [...t.plist].sort((a, b) => b.value - a.value).slice(0, 6);
    const link = (href, text) => `<a href="${href}" class="text-[12px] px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25">${text}</a>`;
    const rec = t.record ? `${t.record.wins}-${t.record.losses}${t.record.ties ? `-${t.record.ties}` : ''}` : '';
    return `<div class="pr-8 mb-4"><div class="text-[20px] font-bold text-zinc-100 truncate">${Vault.escapeHtml(t.teamName)}</div>
        <div class="text-[12px] text-zinc-400 mt-1">${[rec, Vault.MODE_LABEL[Vault.teamMode(t)], needs.length ? `Thin at ${needs.join(', ')}` : ''].filter(Boolean).join(' • ')}</div></div>
      <div class="flex flex-wrap gap-2 mb-4">${link(`${Vault.linkTo('team-analyzer.html')}&team=${t.rosterId}`, 'Open team')}${link(`${Vault.linkTo('trade.html')}&coach=team&with=${t.rosterId}`, 'Start a trade')}</div>
      <div class="grid grid-cols-4 gap-2 text-center py-3 border-y border-white/10 mb-4">${stat(`#${rank}`, Vault.term('overall', 'Value'))}${stat(t.opt ? t.opt.toFixed(1) : '—', Vault.term('lineupPpg', `Lineup #${ppg}`))}${stat(pct(p?.playoffPct ?? t.playoffPct), Vault.term('playoffs', 'Playoffs'))}${stat(pct(p?.championshipPct), Vault.term('title', 'Title'))}</div>
      <div class="text-[11px] text-zinc-400 uppercase tracking-wider mb-2">Most valuable players</div>
      <div class="space-y-1.5 text-[13px]">${best.map(a => `<div class="flex items-baseline justify-between gap-3"><span class="min-w-0 text-zinc-200">${Vault.playerLink(a.name)} <span class="text-[12px] text-zinc-500">${Vault.posMeta(a)}</span></span><span class="mono text-zinc-400">${fmtInt(a.value)}</span></div>`).join('')}</div>`;
  }
  async function openTeam(id) {
    show();
    const want = `team-${id}`;
    cardOpen = want;
    body().innerHTML = '<div class="text-[13px] text-zinc-400 py-16 text-center">Loading the team…</div>';
    try {
      const all = await leagueTeams(), t = all.find(x => String(x.rosterId) === String(id));
      if (cardOpen === want && t) { body().innerHTML = teamCardHtml(t, all); box.firstElementChild.scrollTop = 0; }
    } catch {
      if (cardOpen === want) body().innerHTML = '<div class="text-[13px] text-zinc-400 py-16 text-center">The team card couldn\'t load. Try again in a moment.</div>';
    }
  }
  // Capture, because a name often sits in a row that does something else when clicked.
  document.addEventListener('click', e => {
    const el = e.target.closest?.('[data-player], [data-team]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    if (el.dataset.team) openTeam(el.dataset.team);
    else open(Vault.normalizeName(el.dataset.player), el.dataset.player);
  }, true);

  window.PlayerCard = { load, open, outTip, setWindow(days) { trendWindowDays = days; applyTrendWindow(); } };
})();
