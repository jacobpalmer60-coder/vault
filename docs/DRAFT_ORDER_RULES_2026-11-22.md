# Draft Center — rule and evidence contract

**Rookie draft slots are not Sleeper's live team rankings.** Vault reads actual roster settings `ppts` and `ppts_decimal`, the winners bracket, and original/current traded pick ownership. It uses all teams symmetrically.

- Non-playoff teams: rank by lowest available Max Points For once the playoff field is established. Equal MPF or missing data leaves ambiguous slots unresolved.
- Playoff teams: only completed Sleeper placement games (`p`, winner `w`, loser `l`) establish an exact finish. Eliminated teams from completed non-placement matches can show a **round band** (e.g. slots 5–6) before the classification game is final.
- Before the bracket fills, the top playoff count by current record is a **projection**, not confirmed participation. Users can set the actual playoff field and override any slots for their commissioner's special rules.
- Linear: identical slot each round. Snake: reverse even rounds. 3RR: reverse rounds 2 and 3, then alternate rounds from normal round 4.
- The selected season must follow the Sleeper league season for source MPF/bracket results to apply; later draft classes remain unknown unless manually modeled.
- Saved overrides live in browser local storage by league and draft season. They are not Sleeper settings, and other managers/devices will not see them automatically. Use **Copy shareable model link** to transfer the chosen rule assumptions and overrides to another browser.
- Original owner determines the slot; the current holder receives the asset. This is true for every manager, including traded 2027/2028 firsts.

The model is `draft-rules.js`; `draft-center.js` is presentation only. `scripts/check-draft-activity.js` is the regression test. Sleeper reference: https://docs.sleeper.com/.
