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
| `draft.html` | Draft Center: league-wide MPF, actual pick ownership, playoff elimination bands and commissioner-configured draft slots (linear, snake, 3RR) |
| `activity.html` | League Activity: complete transactions across Sleeper seasons, all teams, draft selections and missing-week disclosure |
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
| `draft-rules.js`, `draft-center.js` | Read-only commissioner-configurable draft order with distinguishable evidence, projections and overrides |
| `activity-model.js`, `activity.js` | Read-only historical transaction events and all-manager timeline; missing weeks remain unknown |

**Data jobs** (`.github/workflows`).

| Job | When | Does |
|---|---|---|
| Update data | daily at 07:00 UTC | Refreshes KTC's versioned public player pool, projections, injuries, prices, historical values, grades and player metadata. Independent upstream failures retain the last-good file and report a warning. Full history is stored on the `data-history` release; pages read compact files in `data/history/`. |
| Unified Sleeper ingestion | scheduled hourly as backup, with sequential self-chain | Crawls completed trades, then collects encrypted full-league context at 400 Sleeper requests/minute per sequential phase; uploads raw trade archives and sealed private snapshots. The standalone league-pull workflow is retired. Market pricing now runs separately so a computation failure cannot block collection. |
| Price Sleeper market history | every six hours, or when the collector flags overdue pricing | Reads already-published trade archives without Sleeper API calls, processes them in bounded season/format shards, refreshes trade-derived prices and current Trade Lab counts, and keeps last-good public data if the job fails. |
| Refresh projections | scheduled every three hours and triggered by successful ingestion | Updates projections between daily KTC refreshes. |
| Market history | Mondays | Updates long-run player trade-history and seasonal timing archives. |
| Check site code / Browser UI smoke | on code changes | Regression checks plus Chromium fixture tests for draft, activity, managers, and grades. The fixture suite is not full production-league acceptance. |

**Research refresh boundaries:** `trade-lab-current.json` is automatically regenerated when the independent repricing job completes all six market formats; it shows factual collected/priced totals and never invents predictive accuracy. Historical outcomes, `trade-lab.json` and findings still come from separate private VaultValues research and are clearly dated. The live-league acceptance workflow checks actual Sleeper transaction parity and populated Chromium pages daily. The private research repo's nightly shadow study does not automatically publish recalibrated historical Trade Lab to this public site. Recent trades and market history can also lag if ingestion has not successfully finished publishing; do not infer their freshness from today's KTC `updated` timestamp alone.

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

## November 22: additive market-first trade engine (implemented)

Based on the completed November 22 outcome study (sample 1/10, 306,578
fully priced mature trades), **the primary trade price is now the additive
sum of independently estimated player and pick market values**.
The retired package-consolidation curve is retained only for research and
price comparisons; its previously accepted-trade-calibrated premium can no
longer make a valuable secondary player nearly disappear from live pricing.

The evidence: for player-only one-for-two trades, trade-day additive
prices selected the higher additive market-value side one year later
**82.83%** (2024, 4,707 decisive) and **86.36%** (2025, 5,878)
of the time versus **62.06%** and **63.46%** for the former full
package curve. The results favor additive pricing by 20.77 and 22.90
percentage points on this particular outcome target. For the 1,245
near-equal-lead 1-for-2 cases the corresponding rates are 92.21%
versus 83.21%. These measure *future additive KTC market-price direction
in completed trades*, NOT playoff outcomes, manager acceptance, or actual
roster value. Model overlap means they are not a sealed holdout.

**Affected surfaces:** calculator price bar, both teams' grade inputs,
verdict-piece comparison, Even It Out and trade-matching screens,
Coach pricing and trade offers, manager negotiation price checks, and
historical/current Trade Grades are now consistent with `Vault.marketSideValues`.
`Vault.tradeSideValues` remains solely the archived curve for market-analysis
pipelines and a separate historical price comparison. Consolidation remains
meaningful through actual projected lineup shifts, depth, team timeline,
and documented, smaller future-return tilts; it is not an automatic dollar
premium.

**Important calibration warning:** the existing 14% Fair / 41% Unfair
breakpoints were originally set against the old package-price distribution
and are now provisional. Prior verdict tier success rates are hidden rather
than shown as if they were calibrated on the new formula. Individual
prediction/acceptance models and roster projections retain their documented
limitations and must be validated independently before new confidence
claims. No new statistical probabilities were invented.

Regression suite:

```powershell
node scripts/check-market-price-rollout.js
node scripts/check-calculator-deep.js
node scripts/check-trade-decision-policy.js
node scripts/check-trade-pricing-reconciliation.js
node scripts/check-math.js
node scripts/stamp-assets.js --check
```

## November 22: additive versus package pricing audit (real trade regression)

The Trade Calculator now labels **two different price baselines**:
**market-price sum** (KTC values adjusted by recent trade premiums, then added)
and **Vault package model** (the existing nonlinear consolidation rule used
by the current grades). When the two differ by 15+ percentage points, the
trade card shows a warning and an exact four-way price reconciliation,
including the approximated KTC-calculator read. Two-for-one deals also show
the implied marginal contribution of the smaller piece to that specific
package, NOT its standalone sale price.

Reproduced with the **2026-11-22 SF, TE-premium** price snapshot: Skat Pack
sends Denzel Boston (4,472) plus Corey Kiner (1,984); TURBONUTZ sends
George Kittle (4,524). Listed KTC prices differ **35.19%**, additive
premium-adjusted values differ **35.02%**, Vault's nonlinear package
model reads **1.38%**, and Vault's KTC-calculator approximation reads
**33.66%**. The fair curve attributes only **about 37 of Kiner's
1,863 market-adjusted points (~2%)** to that particular package.

This explains the screen's discrepancy, but it does **not** establish
that 37 is what Kiner is actually worth or that Vault's curve is a better
predictor than KTC. The curve was calibrated to *completed, accepted trades*,
not an untouched manager-aware future holdout or rejected offers. An extra
percentage of completed trades labeled Fair is not proof of normative fairness.
No live valuation coefficients or roster-specific grades were reweighted in
this display and math audit.

Regression commands:

```powershell
node scripts/check-trade-pricing-reconciliation.js
node scripts/check-calculator-deep.js
node scripts/check-trade-decision-policy.js
node scripts/check-trade-price-separation.js
node scripts/stamp-assets.js --check
```

## November 22: four-area Trade Calculator consistency pass

The calculator now separates **market price**, **each team's benefit**, and
**simulated manager willingness** in its trade summary. This makes the four
distinct decisions understandable without pretending the negotiation model
reports actual accepted-offer probabilities.

- **Correctness:** `trade-policy.js` supplies shared side-neutral price reporting
  and makes the negotiation model's possible disagreement with the receiving
  team's advice explicit. Real trades can be accepted even when the deal scores
  poorly for one team, so a poor advisory grade is *not* treated as proof of rejection.
- **Live-playtest correction (Nov 22):** If the offer is already graded
  Toss-up or better for both teams, Even It Out rejects one-sided giveaways,
  declines changes that materially worsen the raw or package price, and requires
  a measurable improvement. For an already 1%-apart offer, "no meaningful
  improvement found" is better than adding an unnecessary throw-in. The
  suggested alternative displays price and grade-score changes for both sides.
- **Availability (Nov 22):** Even It Out is now visible and manually searchable
  on **every populated offer**, including Toss-up/Toss-up trades. No automatic
  candidate search runs for already-balanced offers; the user can request
  meaningful alternatives, and both teams must pass the existing checks.
- **Search quality:** Even It Out tests add, remove, multi-piece and mixed
  add-and-remove swaps. Its bounded, diversified shortlist preserves viable
  swaps that an exclusively raw-price ordering would miss. Both participants
  must still satisfy the original price, roster and projected-acceptance checks.
- **Evidence:** negotiation responses show available league-trade history and
  clearly label model uncertainty. No empirical acceptance percentage has
  been invented and the willingness coefficients have **not** been recalibrated.
- **Interface:** the trade card distinguishes team-specific grades from
  the market-only additive/package price gap and from the separate response
  model. The existing two-sided impact and What-if controls remain intact.

Repeatable checks:

```powershell
node scripts/check-trade-decision-policy.js
node scripts/check-calculator-deep.js
node scripts/check-trade-reliability-pass.js
node scripts/check-trade-stress.js
node scripts/check-trade-stress-ui.js
node scripts/check-trade-mobile-tabs.js
node scripts/check-trade-price-separation.js
node scripts/stamp-assets.js --check
```

The pure-JavaScript policy and existing deep calculator assertions were
exercised in an isolated JavaScript runner against the branch's actual source;
a populated-league browser test and a full local Node suite still need to be
run before claiming a fully verified deployment. See
`docs/TRADE_CALCULATOR_FOUR_PHASE_PASS_2026-11-22.md` for release gates and
historical-validation limitations.

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

### Experimental separation of market prices and team-specific trade value

A **research-only** comparison now reports additive current market prices,
the existing nonlinear consolidation adjustment, separately supplied
before/after roster impacts for both teams, and separately supplied
manager acceptance judgments. Missing roster/acceptance evidence is
explicitly marked unknown rather than inferred from prices.

```powershell
node scripts/check-trade-price-separation.js
node scripts/review-trade-separation.js docs/trade-separation-example.json
node --max-old-space-size=6144 scripts/benchmark-separated-trade-pricing.js > separated-pricing.json
node scripts/report-separated-trade-pricing.js separated-pricing.json > separated-pricing-report.txt
Get-Content separated-pricing-report.txt
```

Read [the research design](docs/TRADE_PRICE_SEPARATION_RESEARCH.md)
for historical data limitations and validation requirements. **This work
does not modify live trade grades, Coach, Even It Out or any price feed.**

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


## Site-wide acceptance

The new experience includes deterministic code tests and a **real headless Chromium** smoke suite with fixture Sleeper records. Those do not replace physical iOS/Android checks or independent verification against your particular league.

```sh
node scripts/check-draft-activity.js
node scripts/check-sitewide-quality.js
node scripts/check-leaguewide-parity.js
node scripts/check-html-scripts.js
node scripts/stamp-assets.js --check
```

On GitHub, the `Browser UI smoke — Vault` workflow runs Chromium at **320, 390, 768 and 1280px** and uploads screenshots as an artifact. Locally, install Playwright and Chromium to run `node scripts/check-browser-ui.cjs`.

Draft rules are stored **only in this browser** for each league and draft class, but the Draft Center can copy a shareable link containing the current model settings. Commissioners do not gain edit permissions on Sleeper through Vault. Unknown results and equal-MPF ties never become confirmed picks.


### Trade evidence and accessibility

`trade-evidence.js` is a pure, shared contract for Managers and Trade Grades. Actual completed Sleeper trade counts remain distinct from reliable historical valuation counts; uncertain manager attribution and missing weeks stay disclosed. The trade list uses progressive disclosure. Managers' expandable rows and sorting headers are keyboard buttons, not mouse-only table rows.

Run `node scripts/check-trade-evidence.js` to test multi-manager parity, incomplete prices, duplicates and uncertain attribution. The browser smoke workflow also covers the trade views with a deterministic multi-manager fixture.

Draft Center tables transform into labeled pick/manager cards on phones narrower than 640px, retaining normal multi-column tables on desktop. Chromium smoke verifies that current pick owners and playoff evidence remain visible at 320px/390px.
