# WATCON Conveyance Tracker — UI/UX Summary

A mobile-first web app (Next.js App Router, React, Tailwind CSS, Prisma/Postgres) that field staff use to log daily travel ("conveyance") and expenses, and that a manager uses to review and export monthly reports. Designed to be **foolproof for non-technical users**: minimal jargon, big touch targets, live feedback, and a bilingual UI (English / Hindi toggle in the top nav).

## Overall structure

Three tabs in a top navigation bar, plus a language toggle:

1. **Check In** (`/app`) — the main daily screen for employees.
2. **Admin** (`/app/admin`) — PIN-gated monthly report for managers.
3. **Settings** (`/app/settings`) — PIN-gated company/staff/location management.

There is also an offline fallback page (PWA-style).

## 1. Check In screen (employee-facing, the core UX)

**Log Site Visit card** — a single vertical form:

- **Your Name** — searchable combobox of active employees. The device remembers the selection in a cookie, so returning users are pre-selected. Selecting a name immediately shows that person's context.
- **Trip header card** — appears after name selection. Shows:
  - Trip number badge (Trip 1, 2, …) and "starting a new journey" hint.
  - **Starting point → destination** flow: two endpoint cards with an arrow between them. The starting point is auto-resolved (head office by default, or the employee's assigned day-start site such as a showroom) and shown instantly; once a trip is logged, the next trip's start is "carried over" (locked, labeled auto) from the last destination. Each endpoint has a Navigate button (opens maps).
  - **Today's totals**: running distance (km) and conveyance amount (₹).
  - **Reset journey** button (with confirm) to restart the day from the origin.
- **Where are you going?** — searchable combobox of destinations, grouped: *Recent* (pinned per employee), *Master Locations*, *My Saved Locations* (personal/shared, with "manual" tag if no coordinates). Alternative: **Use current GPS** button.
- **GPS capture panel** — deliberately jargon-free (never shows "coordinates" or "accuracy"). Big "Get my location" button, silent auto-retries on poor fixes, friendly permission-denied and error states, then shows a plain address + "X km away from <origin>", a Confirm button, and an optional "save this place for next time" name field.
- **Mode of transport** — three large toggle cards (Bike / Car / Bus-Metro) each showing its ₹/km rate; Bus/Metro also accepts an actual fare input (blank = auto-calculate).
- **Manual distance** — checkbox + km input, offered for GPS/custom destinations; forced when a saved location has no coordinates.
- **Live estimate** — debounced (~350 ms) server preview showing from → to, distance, fare, duration, and a "you're already here" guard that blocks logging a zero trip.
- **Log This Visit** — full-width primary button with loading state; success/error messages appear in a colored status banner.
- **Recent trips today** — numbered timeline of the day's legs (from → to, km · ₹, Navigate button), with a journey total row.

**Miscellaneous Expenses card** — log non-travel expenses by category (with custom "Other"), amount, description, and optional bill upload (stored privately, accessed via signed URLs).

**Today's Summary card** — streams in below (Suspense skeleton): the selected employee's own trips and misc expenses for today with per-section totals and a grand total. Scoped to the device's selected employee for privacy — nobody sees anyone else's day here.

## 2. Admin screen (manager-facing)

- Locked behind a **PIN gate**.
- **Month picker** (defaults to current month, any past month viewable) and an **employee filter** validated against the live roster.
- **Stat cards**: employee count, site count, trip totals (count, km, ₹) and misc totals — aggregated in the database over the whole period, not just the visible page (300-row pages).
- Tables of journeys and misc expenses, **export/download links** that always match the current filters, and a **location approvals** section for employee-submitted custom locations.

## 3. Settings screen

- Same **PIN gate**.
- **Company settings**: name, conveyance rates (Bike / Car / Bus-Metro per-km).
- **Staff manager**: add/edit employees (code, name, designation, department, vehicle, status) with smart suggestions (existing designations/departments; defaults to the most common value) and an assignable **default starting point** per employee (Head Office or any site flagged as a starting point, e.g. a showroom).
- **Location manager**: master sites with address, landmark, coordinates, geofence radius, office/starting-point flags, and active/inactive status.

## Key UX principles embodied in the code

- **Instant feedback, no dead waits**: master data is cached and streams first; slow queries sit behind Suspense skeletons; the starting point renders client-side immediately on name select while the server confirms.
- **Never show misleading data**: stale previews are cleared on selection change; addresses are left blank rather than guessed; totals come from full-period aggregates, not visible rows.
- **Forgiving inputs**: debounced previews, inline field-level validation with red borders and plain-language messages, auto vs. manual distance fallbacks.
- **Low-literacy-friendly GPS**: no technical vocabulary, automatic retries, one big button per step.
- **Privacy by scoping**: employees see only their own day; managers unlock everything via PIN.
- **Bilingual**: every label goes through an en/hi dictionary; toggle persists.
- **Mobile-first visual language**: card-based layout, badge/pill accents in a brand color, tabular numerals for money and distance, Lucide icons, generous tap areas.
