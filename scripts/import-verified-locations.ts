/**
 * Apply verified Google Maps coordinates to the site master.
 *
 * Every distance and fare in this system is measured from Site.latitude /
 * Site.longitude, so a pin in the wrong place is money paid at the wrong rate.
 * This takes the audited CSV produced from /api/export/locations and writes the
 * "Corrected Latitude"/"Corrected Longitude"/"Recommended Geofence (Meters)"
 * columns back onto the matching Site rows.
 *
 *   npx tsx scripts/import-verified-locations.ts <file.csv> --dry-run
 *   npx tsx scripts/import-verified-locations.ts <file.csv>
 *
 * Deliberately narrow: it touches coordinates and geofence radius ONLY. The
 * written address, name, city and status are what staff recognise a site by and
 * are left exactly as they are.
 *
 * Safety: --dry-run prints the full plan without writing. A real run first
 * writes a rollback CSV of the current coordinates, then updates inside a single
 * transaction, then clears the distance cache — cached legs were computed from
 * the OLD pins, and a stale cache would silently mask every correction.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const file = argv.find((a) => !a.startsWith("--"));

/** RFC 4180 parser — the remarks columns contain commas and escaped quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** India's bounding box — catches a swapped lat/lng or a stray decimal point. */
function insideIndia(lat: number, lng: number): boolean {
  return lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98;
}

const EARTH_RADIUS_M = 6_371_000;
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

interface Planned {
  code: string;
  name: string;
  status: string;
  fromLat: number; fromLng: number; fromRadius: number;
  toLat: number; toLng: number; toRadius: number;
  shiftM: number;
}

async function main() {
  if (!file) {
    console.error("Usage: npx tsx scripts/import-verified-locations.ts <file.csv> [--dry-run]");
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, "").trim());
  const header = rows[0];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV is missing the "${name}" column.`);
    return i;
  };
  const cCode = col("Code");
  const cLat = col("Corrected Latitude");
  const cLng = col("Corrected Longitude");
  const cGeo = col("Recommended Geofence (Meters)");
  const cStatus = col("Verification Status");

  const sites = await prisma.site.findMany({
    select: { id: true, code: true, name: true, latitude: true, longitude: true, geofenceRadius: true },
  });
  const byCode = new Map(sites.map((s) => [s.code, s]));

  const planned: Planned[] = [];
  const skipped: { code: string; why: string }[] = [];
  const unknown: string[] = [];

  for (const r of rows.slice(1)) {
    const code = r[cCode]?.trim();
    if (!code) continue;

    const site = byCode.get(code);
    if (!site) { unknown.push(code); continue; }

    const lat = parseFloat(r[cLat]);
    const lng = parseFloat(r[cLng]);
    // A blank corrected coordinate means the auditor could not place the site.
    // Leaving the old pin is the honest outcome — better a known-bad value
    // flagged in this report than a guess written in as if it were verified.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped.push({ code, why: `no corrected coordinates (${r[cStatus] || "no status"})` });
      continue;
    }
    if (!insideIndia(lat, lng)) {
      skipped.push({ code, why: `coordinates outside India: ${lat}, ${lng}` });
      continue;
    }

    const radiusRaw = parseInt(r[cGeo], 10);
    const toRadius = Number.isInteger(radiusRaw) && radiusRaw > 0 ? radiusRaw : site.geofenceRadius;

    planned.push({
      code, name: site.name, status: r[cStatus] || "",
      fromLat: site.latitude, fromLng: site.longitude, fromRadius: site.geofenceRadius,
      toLat: lat, toLng: lng, toRadius,
      shiftM: Math.round(metresBetween(site.latitude, site.longitude, lat, lng)),
    });
  }

  const changed = planned.filter(
    (p) => p.shiftM > 0 || p.toRadius !== p.fromRadius,
  );

  console.log(`\nCSV rows:            ${rows.length - 1}`);
  console.log(`Sites in database:   ${sites.length}`);
  console.log(`Matched and planned: ${planned.length}`);
  console.log(`Actually changing:   ${changed.length}`);
  console.log(`Skipped:             ${skipped.length}`);
  if (unknown.length) console.log(`Unknown codes:       ${unknown.join(", ")}`);

  const bigMoves = [...changed].sort((a, b) => b.shiftM - a.shiftM).slice(0, 10);
  console.log("\nLargest pin corrections:");
  for (const p of bigMoves) {
    console.log(`  ${p.code.padEnd(9)} ${(p.shiftM / 1000).toFixed(2).padStart(7)} km  ${p.name}`);
  }

  if (skipped.length) {
    console.log("\nSkipped — coordinates left untouched:");
    for (const s of skipped) console.log(`  ${s.code.padEnd(9)} ${s.why}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written.\n");
    return;
  }

  // Rollback file first — written before any UPDATE, so it always reflects the
  // pre-import state even if the transaction below fails halfway.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const rollback = `locations-rollback-${stamp}.csv`;
  writeFileSync(
    rollback,
    ["Code,Latitude,Longitude,Geofence Radius (m)"]
      .concat(sites.map((s) =>
        [s.code, s.latitude.toFixed(6), s.longitude.toFixed(6), s.geofenceRadius].map(csvCell).join(",")))
      .join("\n"),
    "utf8",
  );
  console.log(`\nRollback written to ${rollback}`);

  await prisma.$transaction(
    changed.map((p) =>
      prisma.site.update({
        where: { code: p.code },
        data: { latitude: p.toLat, longitude: p.toLng, geofenceRadius: p.toRadius },
      }),
    ),
  );
  console.log(`Updated ${changed.length} sites.`);

  // Every cached leg was measured between the OLD pins. Its key encodes those
  // old coordinates, so stale rows would never be read again anyway — but they
  // would linger forever, and any leg whose pin did not move would keep serving
  // a distance from whichever provider was configured at the time. Clearing is
  // cheap; the cache refills on first use.
  const purged = await prisma.distanceCache.deleteMany({});
  console.log(`Cleared ${purged.count} cached distances — they will re-resolve on next use.\n`);
}

main()
  .catch((e) => { console.error("\nImport failed, nothing committed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
