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
| Maps         | Google Distance Matrix (optional) → OSRM (free) → Haversine fallback |
| Geocoding    | OpenStreetMap Nominatim (free, no key) for GPS reverse-geocoding |
| PWA          | Manifest + service worker (app-shell cache, offline page) |
| Uploads      | Supabase Storage (miscellaneous-expense bill attachments) |
| Integrations | Resend (email), Cloudflare R2 (files), Sentry, PostHog — drop-in via env |

> The app runs **fully offline of any third-party key**. Google Maps, Vercel
> Blob, Resend, R2, Sentry and PostHog are optional — without a Maps key the
> distance engine falls back to OSRM then a road-factor-adjusted Haversine
> formula, GPS reverse-geocoding uses free Nominatim, and without a Blob token
> expenses still save (only file upload is disabled). Notifications stay in-app.

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

## Miscellaneous expenses & custom locations

Beyond conveyance legs, the app records **non-conveyance expenses** and lets
staff travel to **locations that aren't in the master site list** — both kept
cleanly separate from the existing journey/reimbursement logic.

### Miscellaneous expenses (`/app` → *Miscellaneous Expenses*)
- Categories: Parking, Toll Tax, Food, Tea/Coffee, Auto Repair, Vehicle
  Washing, Fuel, Hotel, Courier, and **Other** (free-text category).
- Each entry has amount, date, optional description, notes and an optional
  **bill upload** (PDF/PNG/JPG/JPEG/WEBP, ≤ 10 MB) to a **private** Supabase
  Storage bucket via signed URLs — see [docs/STORAGE.md](docs/STORAGE.md).
  Conveyance legs support the same bill attachment from the day summary.
- Add / edit / delete freely. Totals surface in the day summary
  (Conveyance Total · Miscellaneous Total · **Grand Total**) and never affect
  conveyance calculations.

### Custom & GPS locations (`/app` → *Log Site Visit* → destination)
The destination picker offers master sites **plus** three ways to reach an
unlisted place:
- **📍 Use Current GPS** — captures browser geolocation, reverse-geocodes it
  (Nominatim), shows the detected address, and optionally saves it as a
  reusable personal location.
- **➕ Add Custom Location** — manual entry (name, address, landmark, city,
  state) for when GPS is unavailable; distance is entered by hand.
- **★ My Saved Locations** — personal locations appear only for their owner.

Distance for GPS/custom destinations flows through the existing engine
(Google → OSRM → Haversine), with a **manual-distance** fallback. Legs are
tagged **Master / GPS / Custom** for report filtering.

**Admin** (`/app/admin`): promote a frequently-used personal location to a
**global** one (visible to everyone), view Conveyance / Miscellaneous / Grand
totals, filter entries by location type, and export three CSVs — **Summary**
(per employee-day totals), **Conveyance** (per-leg, `?type=` filterable) and
**Miscellaneous**.

### Environment
| Var | Purpose | Required? |
|-----|---------|-----------|
| `GOOGLE_MAPS_API_KEY` | Best-accuracy distance/geocoding | Optional (OSRM + Nominatim used otherwise) |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage for bill uploads (bucket auto-created) | Only if attachments are used |

After pulling these changes, run `npm run db:push` (or `npx prisma db push`)
to create the new `MiscellaneousExpense` / `UserCustomLocation` tables and the
additive `Journey` columns — existing data is untouched.

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
