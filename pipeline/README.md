# OddsAura zero-key data pipeline

This pipeline reads public football JSON, normalizes fixtures and any available market prices, calculates probabilities, builds tickets and writes one public snapshot to `data/public/snapshot.json`.

It requires no account and no API key. GitHub Actions runs it every two hours and keeps the last successful snapshot if the upstream source is unavailable.

The public repository is deliberately used only for public football data. User passwords, payment information and private subscription records must never be committed here.

Run locally with `npm run data:update`. Validate the mathematical and ticket rules with `npm run data:test`.
