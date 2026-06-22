# Watcon Conveyance Tracker

Enterprise employee travel & conveyance management platform for Watcon
International. Field staff punch in/out at sites (GPS-verified against a
geofence); the system computes inter-site distance server-side from Okhla HQ
across the day, derives reimbursement from configurable per-km / flat rates,
and pushes claims through a four-stage approval ladder.

Built from the real master data: **73 sites** (SITE LIST 2026) and **33 staff**
(staff conveyance sheet), plus the **Okhla Phase-II head office** as the
default journey origin.

---

## Tech stack

| Layer        | Choice |
|--------------|--------|
| Framework    | Next.js 15 (App Router, Server Actions) + React 19 + TypeScript |
| Styling      | Tailwind CSS (light theme, 2px radius), lucide-react icons |
| Data         | Prisma ORM. **SQLite for local dev**, Postgres for production |
| Auth         | DB-backed sessions, signed JWT cookie (`jose`), bcrypt, RBAC |
| Maps         | Google Distance Matrix (optional) → Haversine fallback |
| PWA          | Manifest + service worker (app-shell cache, offline page) |
| Integrations | Resend (email), Cloudflare R2 (files), Sentry, PostHog — drop-in via env |

> The app runs **fully offline of any third-party key**. Google Maps, Resend,
> R2, Sentry and PostHog are optional — without them the distance engine uses a
> road-factor-adjusted Haversine formula and notifications stay in-app.

---

## Quick start

```bash
npm install
cp .env.example .env        # already created on first run
npm run setup               # prisma generate + db push + seed (real data)
npm run dev                 # http://localhost:3000
```

### Demo logins (password: `watcon123`)

| Role        | Email |
|-------------|-------|
| Super Admin | `superadmin@watcon.net` |
| Admin       | `admin@watcon.net` |
| Manager     | the seeded supervisor — see **Admin → Employees** |
| Employee    | every staff member has a login (email shown in the employee list) |

---

## How the journey engine works

1. The employee's day starts implicitly at **Okhla HQ**.
2. **Punch In** at a site: the browser captures GPS; the server verifies the
   coordinates are within the site geofence (default 200 m) — otherwise the
   punch is rejected (`You are not near this site`). No manual KM entry exists.
3. A **journey leg** is created from the previous location (HQ on the first leg,
   else the last site) to the new site. Distance + reimbursement are computed
   **server-side** and stored.
4. **Punch Out** records duration. **End Day** appends the return leg to HQ.
5. **Build claim** aggregates the month's legs; **Submit** sends it up the
   ladder: Manager → Admin → Finance → Paid.

Every punch, approval, login and CRUD action is written to the **audit log**
with user, IP, device and timestamp.

See [`docs/`](docs) for the [ERD](docs/ERD.md), [API reference](docs/API.md)
and [deployment guide](docs/DEPLOYMENT.md).

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Production build (runs `prisma generate`) |
| `npm run db:seed` | Re-seed from `data/seed-data.json` |
| `npm run db:reset` | Drop + recreate + reseed |
| `npm run db:studio` | Prisma Studio |

## Re-generating master data

`data/seed-data.json` is produced from the two source spreadsheets. To rebuild
it (e.g. after the site list changes), re-run the extraction documented in
[docs/DATA.md](docs/DATA.md).
