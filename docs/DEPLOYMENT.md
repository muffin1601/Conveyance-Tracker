# Production deployment guide

## 1. Switch the database to Postgres

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Provision Postgres (Neon, Supabase, RDS…) and set `DATABASE_URL`. Then:

```bash
npx prisma migrate deploy   # or: prisma db push for the first cut
npm run db:seed             # one-time master data load
```

> The schema is Postgres-clean (no SQLite-only types). For real enum columns you
> may optionally convert the string fields to native `enum`s once on Postgres.

## 2. Verified route memory

After deploying the application schema, apply the idempotent verified-route
schema changes and stamp existing correction route keys:

```bash
npm run db:migrate:verified-routes
npm run db:generate
```

To seed permanent route memory from historical **approved** corrections, first
preview the routes that meet the configured threshold, then apply if the list
looks correct:

```bash
npm run backfill:verified-routes
npm run backfill:verified-routes -- --apply
```

The default threshold is three approvals. `VERIFIED_ROUTE_DETECTION_THRESHOLD`,
`VERIFIED_ROUTE_TOLERANCE_KM`, and `VERIFIED_ROUTE_TOLERANCE_PERCENT` provide
deployment defaults; an administrator can change the active threshold and
tolerances in Correction Intelligence. Manual route edits and automatic
verification changes are recorded in the verified-route audit table.

## 3. Environment variables (Vercel → Project Settings)

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `AUTH_SECRET` | ✅ | 32+ random chars (`openssl rand -base64 48`) |
| `GOOGLE_MAPS_API_KEY` | ⛅ | Enables real road distance + ETA; else Haversine |
| `RESEND_API_KEY`, `EMAIL_FROM` | ⛅ | Transactional email |
| `R2_*` | ⛅ | Receipt / document storage |
| `CRON_SECRET` | ⛅ | Protects `/api/cron/*` |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY` | ⛅ | Monitoring / analytics |

## 4. Deploy to Vercel

```bash
vercel --prod
```

`npm run build` runs `prisma generate` automatically.

### Scheduled jobs (`vercel.json`)

```json
{
  "crons": [
    { "path": "/api/cron/forgot-punchout", "schedule": "0 20 * * *" }
  ]
}
```

Set the `Authorization: Bearer $CRON_SECRET` header in the Vercel cron config.

## 5. Google Maps setup

Enable **Distance Matrix API** + **Geocoding API**, restrict the key by
referrer/IP, set `GOOGLE_MAPS_API_KEY`. Results are persisted in
`DistanceCache`, so a given route is billed at most once.

## 6. Hardening checklist

- [ ] Rotate `AUTH_SECRET`; force HTTPS (cookies are `secure` in production).
- [ ] Set per-site `geofenceRadius` from real surveys (default 200 m).
- [ ] Replace demo passwords; enforce a password reset on first login.
- [ ] Wire Sentry (`@sentry/nextjs`) and PostHog providers.
- [ ] Configure R2 + a signed-URL upload action for claim receipts.
- [ ] Add DB backups + connection pooling (PgBouncer / Neon pooler).
