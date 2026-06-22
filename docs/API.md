# API & Server Actions reference

The app is server-action-first. Mutations are typed, Zod-validated Server
Actions (RPC over POST) rather than REST endpoints. A small number of true HTTP
routes exist for export and scheduled jobs.

## Server Actions

### Auth — `src/app/actions/auth.ts`
| Action | Args | Notes |
|--------|------|-------|
| `loginAction` | `FormData{email,password}` | Creates session, sets cookie, redirects `/app` |
| `logoutAction` | — | Destroys session, redirects `/login` |

### Journey — `src/app/actions/journey.ts`
| Action | Args | Auth | Effect |
|--------|------|------|--------|
| `punchIn` | `{siteId, lat, lng, accuracy?}` | Employee | GPS geofence check → SiteVisit(OPEN) + Journey leg with server-computed km/amount |
| `punchOut` | `{lat?, lng?, accuracy?}` | Employee | Closes open visit, records duration |
| `endDay` | — | Employee | Closes open visit + appends return leg to HQ |

Errors thrown as `Error(message)`; surfaced verbatim in the UI
(e.g. `You are not near <site> (250m away, allowed 200m)`).

### Claims — `src/app/actions/claims.ts`
| Action | Args | Auth |
|--------|------|------|
| `buildMonthlyClaim` | `period?="YYYY-MM"` | Employee |
| `submitClaim` | `claimId` | Owner |
| `decideClaim` | `{claimId, decision:"APPROVED"\|"REJECTED", note?}` | Manager+ (stage-gated: Admin/Finance stages require Admin+) |

### Admin — `src/app/actions/admin.ts`
| Action | Auth |
|--------|------|
| `upsertSite` / `deleteSite` | Admin+ |
| `upsertEmployee` | Admin+ |
| `saveCompanySettings` | Super Admin |

## HTTP routes

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/export/conveyance?period=YYYY-MM` | Manager+ | CSV: per-leg conveyance for the month |
| `GET /api/cron/forgot-punchout` | `Bearer $CRON_SECRET` | Flags stale open visits & notifies (Vercel Cron) |

## RBAC

Roles ranked `EMPLOYEE(1) < MANAGER(2) < ADMIN(3) < SUPER_ADMIN(4)`.
`requireRole(min)` throws `FORBIDDEN` below threshold; pages also guard with
`can(role, min)` and redirect. The sidebar only renders permitted links.
