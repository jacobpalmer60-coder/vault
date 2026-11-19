# The Vault

Dynasty fantasy football tools for any Sleeper league: https://jacobpalmer60-coder.github.io/vault/

A static site on GitHub Pages. There's no server: pages read Sleeper's public API in the browser, plus
JSON files in `data/` that scheduled GitHub Actions refresh.

## How it fits together

**Pages.** Each `.html` file is one page with its own script inside. `index.html` is the way in: a
Sleeper username leads to a league, and a league id to a team. Every tool needs a league in the address
(`?league_id=`).

| Page | What it's for |
|---|---|
| `app.html` | League Overview. No trade content here, by design |
| `team-analyzer.html` | One team: overview, roster, this season, contend or rebuild |
| `trade.html` | Trade Calculator and Trade Coach, the core of the site |
| `trade_grades.html`, `managers.html` | Completed trades in your league |
| `trade_database.html`, `trade_lab.html` | Trades across all leagues |
| `market.html`, `player_rankings.html`, `compare.html` | Players and prices |
| `playoffs.html` | Playoff Race |
| `how_we_grade.html`, `patch_notes.html`, `status.html` | How it works, what changed, data freshness |

**Shared code.**

| File | Holds |
|---|---|
| `vault-core.js` | The math and shared helpers (`Vault`). **Also runs in Node** for the crawl and nightly update |
| `market-data.js` | Market prices from completed trades |
| `coach.js`, `negotiation.js`, `market.js` | Trade Coach, predicted answers, the calculator's market reads |
| `player-card.js` | Player and team pop-ups from any name |
| `season-report.js`, `timeline.js` | This season, and contend or rebuild |
| `vault-nav.js` | Navigation, your team, notices |

**Data jobs** (`.github/workflows`).

| Job | When | Does |
|---|---|---|
| Update data, full value history | daily | `player-value-history.json` lives on the `data-history` release, not in git; pages read `data/history/` |
| Crawl Sleeper trades | hourly, prices saved about every 6 hours | New completed trades, priced at KTC values of their own day |
| Refresh projections | every 3 hours | Sleeper projections, and injury details on game days |
| Update data | nightly | KTC values, value history, grade prices, slim files, season totals on Tuesdays |
| Market history | Mondays | Long-run market files |
| League pull | every 6 hours | Encrypted league data for research |
| Check site code | on push | `vault-core.js` still runs in Node, and the math hasn't moved |

**Research** lives next door in `../VaultValues`: local only, and only aggregates reach the site, through
scripts like `build-trade-lab.js`. Readable team data stays on the computer.

## Working on it

Rules that have bitten before:

- **`vault-core.js` runs in Node too.** Browser-only code at the top level stops the crawl. Use
  `globalThis.x?.()`, and run `node scripts/check-core-loads.js`.
- **The math has a saved test.** `node scripts/check-math.js` shows anything that moved. After a change
  you meant, run it with `--update`.
- **Tailwind is pre-built.** After changing classes, run
  `npx -y tailwindcss@3 -i tailwind.src.css -o tailwind.css --minify`. No class names built at runtime.
- **Asset stamps.** `node scripts/stamp-assets.js` before committing, or browsers keep the old files.
- **Words have one meaning.** New labels go in `Vault.GLOSSARY`, shown with `Vault.term` or `Vault.info`.
- **Names and teams.** Use `Vault.playerLink`, `Vault.teamLink`, `Vault.teamLabel` and `Vault.findSleeperId`.
  Team names only come through `Vault.teamLabel`, which is the security fix for names with script in them.
- **Trade values are relative.** `tradeSideValues` totals are never shown. Suggested trades pass
  `negJudgeFor`.
- **Every visible change** gets a plain-language line in `patch_notes.html`, and `how_we_grade.html` has
  to stay true.

## Long-term trade-value research

Run `node scripts/diagnose-value-aggregates.js` to reproduce the published
retrospective diagnostic from the checked-in Player Market, research insights,
and proof data. The saved November 17 output is
`data/market-history/value-diagnostic-2026-11-17.json` (428 player records
with 3.58 million headline-trade observations; **not** independent examples).
It documents existing weaknesses and is **not** a new full raw-data run.


Run `node scripts/benchmark-future-values.js` to compare the unchanged-value baseline
with a position/age model trained on 2022-2023 outcomes and evaluated on 2025 origins
with full one-year follow-up. The existing age curve is shown only as a **retrospective**
reference: it was built using 2026 data and must not be treated as independent
holdout evidence. The benchmark reports errors both excluding missing one-year prices
and treating them as zero, because an absent KTC listing cannot always prove the
asset became worthless. It also has survivor bias: the current player catalog is
needed to recover historical ages. Run with `--write` only when you deliberately
want to save the dated benchmark snapshot.

`node scripts/check-historical-outcomes.js` validates preservation of zero-value
pieces and mirror outcomes. The corrected Player Market one-year results require a
rebuild from the archived raw Sleeper transactions:
`node --max-old-space-size=6144 scripts/market-history/build-player-history.js`
after restoring the `sleeper-trades` release assets to `data/sleeper-trades/`.
Do not update live valuation weights based solely on this benchmark: it studies
historical player prices, not team strategy, acceptance probabilities or trades
that never happened.

### November 17: follow-up analysis (no live math changes)

The next diagnostic separates **confirmed zero** follow-up values from **unknown**
ones, because a missing player price cannot prove a complete loss. The
completed-trade script now shows both **strict complete-case** and **missing
as zero** sensitivity results and groups them by year, calendar quarter/month,
scoring format, trade shape, largest asset's position and original raw-value gap:

```powershell
cd "$env:USERPROFILE\Desktop\vault"
git pull
node scripts/check-historical-outcomes.js
node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js *> trade-cohorts.txt
node scripts/benchmark-rebuild-horizon.js *> rebuild-horizons.txt
node scripts/summarize-value-research.js > research-summary.txt
```

The forecasting tests now enforce **strict as-of outcome availability** for
every test month: an origin from 2021 whose 3-year result is not known until
2024 cannot train a prediction made in 2023. The old 3-year result therefore
had temporal leakage and must not be quoted as a clean holdout. Run
`node scripts/check-rebuild-forecast-chronology.js` to validate chronology,
zero-versus-missing prices, and format isolation. Inspect each horizon's
`trainingCoverage` and `groups.formatAndPosition`; especially the 3-year
forecast's early-2023 months may have very few available training outcomes.
**Do not promote this forecast based on the old benchmark output.**

The rebuilding experiment evaluates price preservation after **1, 2 and 3
years**, with earlier-year training and later-year evaluation and breakdowns
by position, age and league format. It measures **players only**: picks,
original rebuilding-team rosters and manager decisions are not represented,
so it must not be advertised as a rebuild-success prediction.

The Market History builder now omits trades with unknown later prices from
its complete-case player summaries; true observed zeros still count. Rebuild
its published aggregates using the raw trade archive before claiming the
published win rates incorporate this change. The original 2024/2025 reversal
is descriptive and may be affected by season mix, pick conversion,
different follow-up coverage and overlap with the curve's training data.

To compare **completed trade packages** rather than individual player values, restore
the same archive and run
`node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js`.
It deterministically samples roughly one in ten trades by ID; set `SAMPLE_MOD=1`
to process the full archive. The output compares Vault's trade-price winner with
the raw KTC-sum winner against one-year-later asset value, with separate counts
for missing later prices. This is a *retrospective diagnostic*, not a
true untouched holdout: some of those completed trades informed Vault's
existing trade-price curve. Do not make claims of improvement until an
independent prospective split is available.

### November 18: Interactive Trade Stress Test (live feature; no grading changes)

The Trade Calculator now has a **What-if** tab on phones and an expandable
**Trade Stress Test** on desktop, directly below the two manager impact
cards. It uses the same `Vault.simulateTrade` before/after snapshots that
the official grade uses, so the scenario applies the same changed player
or pick price to its owner both **with and without the deal**. Both
participating managers see the resulting change in current roster/pick
value and illustrative lineup points; no logged-in-team special case.

Managers can change:

- A traded player's hypothetical market-value decline (0–60%);
- Games missed (0–17) for that player, using the best available
  replacement lineup and a **17-game illustration**, NOT actual
  week-by-week injury, playoff, or championship odds;
- A traded pick's current **KTC-normalized early/mid/late price tier**
  where Vault already has a tier spread for the effective first or
  second round. Unpriced tiers, already-drafted picks and later rounds
  **do not receive invented prices or future-rookie predictions**.

This is a sensitivity tool, not a new market predictor, offer acceptance
model or trade grade. It does not change player values, rankings,
projections, Trade Coach behavior, or the original league/roster objects.

Regressions and real-browser smoke:

```powershell
node scripts/check-trade-stress.js
node scripts/check-trade-stress-ui.js
node scripts/check-trade-mobile-tabs.js
node scripts/check-calculator-deep.js
# Optional full visual/interaction pass: npx serve -l 5191 .
# npm i --no-save puppeteer-core
# node scripts/smoke-trade-flow.js <SleeperLeagueID>
```

The browser smoke now checks the What-if tab at desktop, phone and narrow-phone
sizes and verifies that changing stress controls cannot change the official
verdict. JavaScript regression tests validate trade-direction symmetry,
missed games, shock pricing, unavailable pick tiers and zero original
roster mutation. A full end-to-end browser session against a live Sleeper
league is still required for a fully verified UI release.

### November 18: trade impact explanations, rookie outcome research, and responsive checks

The calculator now displays the **same side-neutral before/after ledger** for
both trade participants, accompanied by a plain-language description of the
lineup, player-value, and draft-capital changes. This uses the existing
`Vault.simulateTrade` math. Market-pricing weights, team grades, trade-coach
recommendation scoring and future age curves were **not** recalibrated.

The player future-rank view is not a total-team forecast: it omits the future
rookies that picks might become. Mobile trade tabs now support arrow-key,
Home and End navigation as well as touch/click.

Run cheap regressions:

```powershell
node scripts/check-team-impact.js
node scripts/check-trade-mobile-tabs.js
node scripts/check-calculator-deep.js
node scripts/check-rookie-pick-outcomes.js
node scripts/check-rookie-slot.js
node scripts/check-rookie-slot-benchmark.js
node scripts/check-rookie-slot-weighting.js
node scripts/check-rookie-summary.js
node scripts/check-historical-outcomes.js
node scripts/check-trade-outcome-independence.js
node scripts/check-value-research-summary.js
```

Study **unique drafted rookies** and their observed KTC prices a year after
the draft using the historical Sleeper draft archive already stored locally:

```powershell
node scripts/fetch-nfl-draft-years.js
node --max-old-space-size=6144 scripts/benchmark-rookie-pick-outcomes.js > rookie-outcomes.json
node scripts/summarize-rookie-pick-outcomes.js rookie-outcomes.json > rookie-summary.txt
Get-Content rookie-summary.txt
# Optional: every exact slot for a single format and league size
node scripts/summarize-rookie-pick-outcomes.js rookie-outcomes.json --full --format=sf --size=12 > rookie-sf12-full.txt
```

The revised summary defaults to a **short 12-team 1QB and Superflex report**
instead of printing all thousand-plus slot rows. It shows actual one-year
KTC price distributions **weighted by draft selections**, alongside a
separate **rookie-heavy** subgroup (at least 80% of its first round has
verified NFL rookies). For recurring players, every draft choice is priced
at its own draft date plus 365 days rather than inheriting the first
encountered price. This subgroup is a **heuristic**, not proof of the
league's rookie-only draft type, and repeated players across leagues are
not statistically independent. No result has been approved for live
draft-pick valuation; 2025 draft-year coverage and missing historical
pick prices remain key limitations.

The original draft crawl did not have historical rookie-year metadata and produced zero verified rookies. The historical NFL source may cover **2024 but not 2025**. The importer now saves any complete season with at least 200 recorded NFL selections, prints available years, and warns about missing seasons rather than failing because its cross-year total is below an arbitrary threshold. Missing years remain unavailable for trustworthy rookie-price forecasts. The explicit import from nflverse's public NFL draft data supplies verified year, name and position; mismatched or ambiguous identities are excluded. The source cannot identify undrafted free agents or recover years of missing pre-draft pick prices. License and source: https://github.com/nflverse/nfldata/blob/master/data/draft_picks.csv. Import the file locally before analysis.\n\nThe same benchmark also reports **draft-size-specific exact slot groups**
(8–16-team leagues, e.g. 1.01, 1.10, 1.12). A group is included only
when a draft has a complete, sequentially numbered round and enough
distinct rookies. A player selected at different picks in different
leagues can appear once **per slot**; these slot cohorts overlap and must
not be treated as independent trials. Sample size, missing outcomes,
repeated selections and league size are reported explicitly. Startup
drafts still cannot be separated reliably with this data, so these
are descriptive distributions rather than a validated pick prediction.

This is **research, not a deployable pick forecast**: it shows distribution
and missingness by round, format and season, excludes unavailable future
prices rather than fabricating busts, and deduplicates repeated rookie
selections. It cannot infer the odds of any particular 1.01 / 1.12 selection,
reconstruct every team's historic pick ownership or make a sealed
chronological validation claim.

### Independent historical trade validation (research only)

The historical trade-backtest previously used Vault's own nonlinear
`tradeValueRatio` to decide which completed trade side won *in the future*.
That made its trade-direction comparison circular. **The old 2024/2025
Vault-vs-raw percentages are invalid for model selection.** Research
schema v2 now determines the future winner by additive one-year-later
KTC player prices, independently from Vault's predicted trade-day
pricing. A separate **player-only** cohort avoids the approximated
outcomes of future draft picks. Both modes remain retrospective,
potentially overlap Vault's calibration dataset, and do not reconstruct
historical manager rosters or provide acceptance probabilities.

Recompute and inspect the corrected results locally:

```powershell
node scripts/check-historical-outcomes.js
node scripts/check-trade-outcome-independence.js
node scripts/check-value-research-summary.js
node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js > trade-cohorts.txt
node scripts/summarize-value-research.js > research-summary.txt
Get-Content research-summary.txt
```

Run the reliability regressions and inspect whether historical performance
is stable across seasons, draft-pick inclusion and package shapes:

```powershell
node scripts/check-calculator-deep.js
node scripts/check-trade-stress.js
node scripts/check-trade-reliability-pass.js
node scripts/check-trade-accuracy-diagnostics.js
node scripts/check-trade-outcome-independence.js
# Rerun the benchmark after pulling: player-only package shapes are a NEW cohort.
node --max-old-space-size=6144 scripts/benchmark-trade-value-outcomes.js > trade-cohorts.txt
node scripts/audit-trade-accuracy.js trade-cohorts.txt > trade-accuracy-audit.txt
Get-Content trade-accuracy-audit.txt
```

The audit now separates **player-only package shapes** from the full package groups, where draft picks depend on future round-level price proxies. Older `trade-cohorts.txt` files remain readable but cannot display the new player-only shape breakdown. Rerun the benchmark after pulling.

When a retrospective price-direction audit shows a large Vault-versus-raw
gap, inspect its **1-for-1 parity**, **1-for-N package-level disagreements**,
and **starting-price gap** cohorts before changing the live model. Vault's
nonlinear consolidation rule is designed for the *trade's present fairness*
and manager preferences; the audit labels what happens to the original
pieces' KTC price sums a year later. Both questions matter, but they're
not interchangeable. The updated audit reports where disagreement happens;
it does not claim a controlled comparison or validate future acceptance.

The November reliability pass fixes three separate concerns:
**Even It Out** suggestions are bound to the same two managers, selected
assets and timeline; **Trade Coach** clears cached willingness, roster fit,
and scoring when manager context or trade-history profiles change; the
**Trade Stress Test** shows scenario differences for both teams relative
to the unchanged deal without changing the official verdict. These are
guardrails and presentation changes, **not new projected values**.

The summary deliberately rejects old benchmark JSON that lacks
`schemaVersion: 2`. No live trade prices, grades, or coach scores have
been changed. A truly independent evaluation still requires a future
untouched chronological holdout and richer historical roster context.

To exercise a **populated two-team trade** in a real browser at desktop,
phone and narrow-phone widths (plus keyboard tab and overflow checks):

```powershell
npm i --no-save puppeteer-core
# In a separate PowerShell window: npx serve -l 5191 .
node scripts/smoke-trade-flow.js <SleeperLeagueID>
```

The browser test needs Chrome or Edge and a real Sleeper league ID. It was
authored and syntax-checked in the connected coding environment, but full
local-browser execution must happen where the website is accessible. Consult
`docs/TRADE_CALCULATOR_NEXT_PASS_2026-11-18.md` for scope and limitations.

To check every page before pushing, see the top of `scripts/smoke.js`.
