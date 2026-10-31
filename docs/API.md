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

### Distance corrections & verified routes — `src/app/actions/distanceCorrections.ts`
| Action | Auth | Effect |
|--------|------|--------|
| `submitDistanceCorrection` | Employee who owns the journey | Records the submitted distance, evidence, reason, and pending review status |
| `reviewDistanceCorrection` | Admin PIN gate | Approves or rejects once; approval updates the journey and evaluates the approved-route threshold |
| `checkRouteVerifiedDistanceAction` | Route lookup | Looks up active directional route memory |
| `manuallyVerifyRouteAction` / `updateVerifiedDistanceAction` | Admin PIN gate | Creates or updates route memory with a transactional audit record |
| `setVerifiedRouteStatusAction` | Admin PIN gate | Activates, disables, or archives a route with an audit record |
| `getRouteCorrectionHistoryAction` / `getCorrectionIntelligenceDataAction` | Admin PIN gate | Returns correction history, route metrics, and review flags |

Only approved corrections count toward automatic verification. Route memory is
not claim approval. For future visits only, an active verified route whose
submitted/calculated distance exceeds the configured tolerance is automatically
applied at log time. The pre-correction distance is kept in
`Journey.submittedDistanceKm` and an audit record is created in the same
transaction. Distances within tolerance and existing journeys are unchanged;
claims continue through their existing approval workflow.

## HTTP routes

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/export/conveyance?period=YYYY-MM` | Manager+ | CSV: per-leg conveyance for the month |
| `GET /api/cron/forgot-punchout` | `Bearer $CRON_SECRET` | Flags stale open visits & notifies (Vercel Cron) |

## RBAC

Roles ranked `EMPLOYEE(1) < MANAGER(2) < ADMIN(3) < SUPER_ADMIN(4)`.
`requireRole(min)` throws `FORBIDDEN` below threshold; pages also guard with
`can(role, min)` and redirect. The sidebar only renders permitted links.
