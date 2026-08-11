/**
 * Rename GPS legs that were labelled before neighbourhood-level naming existed.
 *
 * Until lib/placeLabel.ts landed, a GPS destination was named "<city>, <state>".
 * In Delhi the city and the state are both "Delhi", so 83 of the 104 GPS legs
 * on record read "Delhi, Delhi" — a name that tells a reviewer nothing about
 * where anyone actually went. Every one of those legs still carries the exact
 * coordinates that were verified at the time, so the better name can simply be
 * recomputed from them.
 *
 *   npx tsx scripts/backfill-gps-names.ts              # dry run — prints the plan
 *   npx tsx scripts/backfill-gps-names.ts --apply      # writes, after a backup
 *
 * Only *generic* names are touched: one whose every comma-part is the city, the
 * state, the country, or a bare "Delhi"/"New Delhi". A name an employee typed
 * themselves ("Hauz Khas Mayfair garden A3", "Chawri bazar") is left alone —
 * they were standing there, the geocoder was not.
 *
 * Distances, amounts, claims and coordinates are never touched: this is a
 * relabelling of the same journeys, so no reimbursement figure can move.
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parsePlace } from "../src/lib/placeLabel";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const UA = "WatconConveyanceTracker/1.0 (report@watcon.net)";
/** Nominatim's usage policy is one request per second. Stay under it. */
const THROTTLE_MS = 1200;

/** Names so coarse they carry no information — the ones worth replacing. */
const COARSE = new Set(["delhi", "new delhi", "india", "unknown", "current location"]);

function isGeneric(name: string | null, p: { city: string | null; state: string | null; country: string | null }): boolean {
  if (!name?.trim()) return true;
  const known = [p.city, p.state, p.country].filter(Boolean).map((s) => s!.toLowerCase());
  return name
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .every((part) => COARSE.has(part) || known.includes(part));
}

const key = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

async function lookup(lat: number, lng: number) {
  const url = new URL(NOMINATIM);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
  return parsePlace(await res.json(), lat, lng);
}

async function main() {
  const legs = await prisma.journey.findMany({
    where: { locationType: "GPS", toLat: { not: null }, toLng: { not: null } },
    select: { id: true, workDate: true, sequence: true, employeeId: true, toName: true, toLat: true, toLng: true },
    orderBy: [{ workDate: "asc" }, { sequence: "asc" }],
  });
  console.log(`GPS legs with coordinates: ${legs.length}`);

  // One lookup per distinct point, not per leg — the same spot is visited again
  // and again, and the geocoder is rate-limited.
  const coords = [...new Set(legs.map((l) => key(l.toLat!, l.toLng!)))];
  console.log(`distinct points to look up: ${coords.length} (~${Math.ceil((coords.length * THROTTLE_MS) / 1000)}s)`);

  const places = new Map<string, Awaited<ReturnType<typeof lookup>>>();
  for (const [i, c] of coords.entries()) {
    const [lat, lng] = c.split(",").map(Number);
    try {
      places.set(c, await lookup(lat, lng));
    } catch (e) {
      console.warn(`  ! ${c} — ${(e as Error).message}; leaving these legs as they are`);
    }
    if (i % 10 === 9) console.log(`  ...${i + 1}/${coords.length}`);
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  // A leg's own name, and the name the NEXT leg shows as its origin, are two
  // separate snapshots of the same place — rename both or the chain reads as a
  // trip from somewhere the employee never was.
  const renames: { id: string; workDate: string; from: string; to: string }[] = [];
  const skipped: { id: string; name: string; reason: string }[] = [];
  const fromUpdates = new Map<string, string>(); // coord key -> new name

  for (const leg of legs) {
    const place = places.get(key(leg.toLat!, leg.toLng!));
    if (!place) { skipped.push({ id: leg.id, name: leg.toName ?? "", reason: "lookup failed" }); continue; }
    if (!isGeneric(leg.toName, place)) { skipped.push({ id: leg.id, name: leg.toName ?? "", reason: "named by hand" }); continue; }
    if (leg.toName === place.label) { skipped.push({ id: leg.id, name: leg.toName ?? "", reason: "already correct" }); continue; }
    renames.push({ id: leg.id, workDate: leg.workDate, from: leg.toName ?? "(none)", to: place.label });
    fromUpdates.set(key(leg.toLat!, leg.toLng!), place.label);
  }

  console.log(`\nto rename: ${renames.length}   leaving alone: ${skipped.length}`);
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  for (const [r, n] of byReason) console.log(`  ${n} × ${r}`);
  console.log();
  for (const r of renames.slice(0, 40)) console.log(`  ${r.workDate}  "${r.from}"  ->  "${r.to}"`);
  if (renames.length > 40) console.log(`  ... and ${renames.length - 40} more`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to save.");
    return;
  }

  // Backup first: this rewrites history that reports are read from.
  const backup = await prisma.journey.findMany({
    select: { id: true, workDate: true, sequence: true, employeeId: true, fromName: true, toName: true },
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = `journey-names-rollback-${stamp}.json`;
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`\nbackup written: ${path}`);

  let done = 0;
  for (const r of renames) {
    await prisma.journey.update({ where: { id: r.id }, data: { toName: r.to } });
    done++;
  }
  console.log(`destinations renamed: ${done}`);

  // Now the origin snapshots on the legs that chained off those destinations.
  let origins = 0;
  const chained = await prisma.journey.findMany({
    where: { fromLat: { not: null }, fromLng: { not: null } },
    select: { id: true, fromName: true, fromLat: true, fromLng: true },
  });
  for (const leg of chained) {
    const label = fromUpdates.get(key(leg.fromLat!, leg.fromLng!));
    if (!label || leg.fromName === label) continue;
    const place = places.get(key(leg.fromLat!, leg.fromLng!))!;
    if (!isGeneric(leg.fromName, place)) continue;
    await prisma.journey.update({ where: { id: leg.id }, data: { fromName: label } });
    origins++;
  }
  console.log(`origins renamed: ${origins}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
