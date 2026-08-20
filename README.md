# learningcoachbackEnd

API backend for [Learning English with Coach](../learningcoach) — a CEFR-aligned English
learning platform (placement testing, lessons/exercises, AI coach, pronunciation
assessment, community rooms, gamification, certificates, subscriptions/billing).

Fastify 5 + TypeScript, talking to Postgres directly via the [`postgres`](https://github.com/porsager/postgres)
package — no ORM, no Supabase client libraries, no PostgREST, no RLS. Authorization is
enforced entirely in the application layer (`requireAuth`/`requireRole` preHandlers per
route — see `src/plugins/auth.ts` and `src/plugins/roles.ts`).

## Stack

- **Fastify 5** — HTTP server, with `@fastify/rate-limit`, `@fastify/cors`, `@fastify/cookie`,
  `@fastify/multipart`.
- **postgres** — direct Postgres driver, tagged-template queries (parameterized by default).
- **jose** — JWT access tokens; refresh tokens are opaque random strings stored hashed
  (revocable individually, unlike a JWT).
- **bcryptjs** — password hashing.
- **Zod** — request validation, one schema file per module.
- **Sentry** (`@sentry/node`) — optional error reporting, off unless `SENTRY_DSN` is set.
- **Vitest** — test runner.

Each domain lives under `src/modules/<name>/` with `routes.ts` / `service.ts` /
`repository.ts` / `schemas.ts`. Cross-cutting helpers are in `src/lib/`.

## Quick start

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET at minimum
npm run migrate         # applies everything in supabase/migrations/, in order
npm run dev              # tsx watch src/server.ts, http://localhost:8787
```

`npm run migrate` is idempotent — it tracks applied filenames in
`public.schema_migrations` and only runs new ones. Migration files live under
`supabase/migrations/` (the folder name is a holdover from before this backend existed;
they're plain SQL run directly against Postgres, nothing Supabase-specific).

## Environment variables

See `.env.example` for the full list with inline explanations. The only two required to
boot are `DATABASE_URL` and `JWT_SECRET`. Everything else degrades gracefully when unset:

- No `OPENAI_API_KEY` → AI-dependent endpoints (TTS/STT/AI Coach/diagnostic grading)
  return a clear "not configured" error instead of failing to boot.
- No `SMTP_*` → transactional emails (password reset, contact notifications, in-app
  notification copies) are logged to the console instead of sent.
- No `SENTRY_DSN` → no error reporting, console/pino logs only.
- `SANDBOX_PAYMENTS_ENABLED` must stay `false` in production — it gates
  `POST /v1/payments/:id/simulate`, the only way to mark a payment `paid` without a real
  gateway webhook (which doesn't exist yet — see the payments note below).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start with hot reload (`tsx watch`) |
| `npm run build` | Type-check + compile to `dist/` (`tsc -p tsconfig.json`) |
| `npm start` | Run the compiled `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run migrate` | Apply pending migrations from `supabase/migrations/` |
| `npm test` | Run the Vitest suite (`src/**/*.spec.ts`) |

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`: builds, uploads Sentry
source maps (if configured), rsyncs the build to a VPS via SSH, symlinks it as the
active release, restarts the `learningcoachbackend` systemd service, health-checks it,
and **rolls back to the previous release automatically if the service doesn't come back
up**. Migrations are **not** run automatically as part of deploy — run `npm run migrate`
manually (over SSH, or from CI) after a deploy that includes new migration files.

There is no staging environment or CI step that applies migrations to a scratch database
to verify they run cleanly from zero — something to add if migrations start getting
complex enough that "worked when I ran it once, forgot the sequence" becomes a risk.

## Payments — current state

There is no real payment gateway integration yet. `POST /v1/checkout-sessions` creates a
pending order with a randomly generated reference and a placeholder Multicaixa-style
entity code; nothing actually charges a card or confirms a real transfer. In production
(`SANDBOX_PAYMENTS_ENABLED=false`), an order sits "awaiting admin confirmation" — an
admin manually reconciles real transfers and calls `POST /v1/admin/payments/:id/activate`.
Wiring up an actual PSP (Multicaixa Express / EMIS / AppyPay or similar) is the real fix;
until then, the frontend checkout page shows an explicit warning that payment details are
placeholders, not a live gateway.

## Testing

`npm test` runs the current suite (error normalization, the OpenAI gateway client, and
the global error handler's leak-prevention behavior). Most business logic in
`modules/*/service.ts` doesn't have test coverage yet.
