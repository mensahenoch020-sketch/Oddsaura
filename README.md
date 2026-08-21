# OddsAura

OddsAura is a keyless football-prediction website. It collects public football JSON on a GitHub Actions schedule, calculates probabilities, creates tickets and publishes one repository snapshot that the website reads directly.

## Current architecture

- `pipeline/` — no-key football collector, flexible probability engine and automatic ticket builder.
- `data/public/snapshot.json` — the latest public fixtures, markets, metrics and published tickets.
- `.github/workflows/update-football-data.yml` — refreshes the public snapshot every two hours and can also be run manually.
- `app/` — public ticket board and automation monitor.
- `backend/` — the earlier PostgreSQL/Railway service, retained as an optional future backend but no longer required by the public ticket board.

No account or API key is required for the current collector. If a public source is temporarily unavailable, the previous successful snapshot remains visible and is marked stale.

## Commands

- `npm run data:update` — collect fixtures and odds, score markets and write the snapshot.
- `npm run data:test` — validate probability and ticket rules.
- `npm run build` — build the website.

## Data safety

Only public football data belongs in the repository snapshot. Never commit passwords, payment records, private subscription data, bookmaker sessions or authentication tokens.

## Market design

The zero-key model already derives match result, double chance, draw no bet, goal totals, team totals, BTTS, correct score, half markets, goal parity, clean sheets, win-to-nil and several combined markets. The snapshot also accepts arbitrary provider markets such as corners, cards, shots and player props without a database enum migration.

Bookmaker booking-code creation is intentionally separate. A code is published only after a future SportyBet adapter can create and verify the saved betslip.
