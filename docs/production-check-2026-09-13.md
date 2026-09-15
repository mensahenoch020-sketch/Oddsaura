# Production verification — 13 September 2026

Deployment remains paused. Browser checks below ran against the existing Railway
release, not the unpublished foundation-repair branch. No stake was placed.

## Consolidation follow-up

The branch now includes current main through 3d253f5. A subsequent pipeline run
at 01:06 UTC preserved the newer paper ledger: 119 recorded, 46 settled,
30 wins and 16 losses. Earlier local generated snapshots are retained in a
named git stash as a backup; they must not be reapplied over the reconciled data.
This resolves the stale-ledger publishing blocker described below as historical
context, subject to preserving any newer automation runs before the final merge.

Chat autoscroll now scrolls the message container only, and mobile input uses
16px text to avoid focus zoom. Both Railway and worker conversion paths now
import the actual source code instead of reconstructing it from account requests.
These changes are bundled locally, not deployed. iPhone verification, destination
market-feed expansion and password-email setup remain open; do not call this a
fully verified production release.

## Observed

- Secure login succeeded; the account displayed Admin access. Admin data loaded.
- Admin reports password email needs setup. No email settings were changed.
- A request for today's 20 SportyBet odds returned a partial code at 17.24.
  Its source selections included September 14, 18 and 19 fixtures: the deployed
  date handling fails this case. The unpublished date fix still needs live retest.
- Generated selection details expanded and collapsed successfully in Chrome.
  Real iPhone keyboard/scroll behavior is not verified. Browser layout measurement
  attempts timed out; no mobile-layout pass is claimed.
- Dedicated converter returned partial betPawa (5/7), Betway (5/7) and BetKing
  (2/7) codes. These were UI-observed responses, not independent destination-slip
  identity verification. Stored-source reuse affected these tests.
- A Betway-to-SportyBet round trip unexpectedly reused seven requested selections
  from a five-selection code. Railway's account-history shortcut was the cause.
  Local fix removes that shortcut and always imports the actual bookmaker code.
- Bet9ja rejected code creation and displayed a manual selection list. It remains
  a release limitation, not a passing conversion.
- Chat repeatedly failed to recognize the letter-only code UZJEEP. Local parser
  now accepts uppercase letter-only codes and explicitly labelled lowercase codes.
- Results Archive/Won displayed four published tickets; Lost changed the heading
  and published-ticket list. Personal codes are not covered by those filters.

## Data refresh

Local pipeline completed with healthy source reports: 1,261 fixtures, 63,633
model scores, 46 selectable predictions and zero qualified daily tickets.
It used 19,337 archived matches plus fresh ESPN records. Pipeline tests passed.

The local ledger has 99 recorded / 41 settled picks, 26 wins and 15 losses,
flat-stake ROI -14.05%. Production Admin shows a newer, different ledger:
107 recorded / 46 settled, 30 wins, ROI -10.3%. Do not overwrite production
history with this branch's refreshed snapshot. Reconcile from current main and
rerun the pipeline before publishing data. Neither sample proves profitability.

## Release gates still open

1. Publish the repaired branch to an approved test environment and retest actual
   source imports, partial-code round trips, exact dates and target totals.
2. Verify composer, keyboard opening/closing, scroll and collapse on an iPhone.
3. Preserve current-main paper and ticket history before publishing refreshed data.
4. Configure password-reset email through the owner's approved mail service.
5. Decide whether Results filters should also cover personal codes; currently they
   apply only to published tickets.
6. Keep Bet9ja marked limited and collect forward results without weakening gates.

The new code changes have regression coverage; local tests do not close the live
release gates above. No push, merge or deployment occurred during this check.
