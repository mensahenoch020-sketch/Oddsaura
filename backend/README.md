# OddsAura API

Railway-ready Fastify API with PostgreSQL/Prisma, scheduled football-data ingestion, mathematical market scoring, ticket generation, admin review, booking codes, results, users and subscriptions.

## Railway setup

1. Create a PostgreSQL service in the same Railway project.
2. Create a service from this GitHub repository and set its root directory to `backend`.
3. Add the variables from `.env.example`. Railway supplies `DATABASE_URL` when PostgreSQL is connected.
4. Set a strong `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
5. Add an API-Football key to `FOOTBALL_API_KEY` when ready to use live data.
6. Deploy, then run `npm run db:seed` once from the Railway service shell.

Health check: `GET /api/health`

## Data workflow

- The scheduled job imports recent results plus fixtures for the next eight days.
- Odds are refreshed at most every three hours per fixture to protect provider quotas.
- The engine computes Poisson score probabilities and blends them with form, venue strength, head-to-head and odds value.
- Candidates must pass both confidence and value thresholds.
- The ticket builder creates Safe, Balanced and High Risk drafts with no duplicate fixture.
- An administrator reviews the draft, adds a SportyBet or other bookmaker code, and publishes it.
- Completed fixtures automatically settle ticket selections; expired tickets disappear from the public API.

## Important booking-code note

The database supports one active code per bookmaker for each ticket. Automatic SportyBet booking-code creation requires a supported SportyBet/provider endpoint or partner integration; until that is available, the admin dashboard stores and publishes the code entered by the administrator.

## Main endpoints

- `POST /api/auth/login`
- `GET /api/tickets`
- `GET /api/fixtures`
- `GET /api/admin/overview`
- `POST /api/admin/sync`
- `POST /api/admin/predictions/run`
- `POST /api/admin/tickets/generate`
- `PATCH /api/admin/tickets/:id`
- `POST /api/admin/tickets/:id/publish`
- `DELETE /api/admin/tickets/:id`
