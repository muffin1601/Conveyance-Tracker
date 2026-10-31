import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { haversineMeters } from "../src/lib/gps";
import { getSettings } from "../src/lib/settings";
import type { VehicleType } from "../src/lib/enums";
import { routeCacheKey } from "../src/lib/routing";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const EMPLOYEE_NAME = "Yogesh (Site Supervisior)";
const AMARYLLIS_ROUTE_DATE = "2026-10-30";
const CONTINUATION_DATE = "2026-10-31";
const AMARYLLIS_NAME = "The Amaryllis, Delhi";
const PUSHPANJALI_DISTANCE_KM = 27;

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: EMPLOYEE_NAME, mode: "insensitive" }, deletedAt: null },
    select: { id: true, name: true, status: true },
  });
  if (employees.length !== 1) {
    throw new Error(`Expected one active ${EMPLOYEE_NAME} record; found ${employees.length}.`);
  }
  const employee = employees[0];
  if (employee.status !== "ACTIVE") throw new Error(`${employee.name} is not active.`);

  const offices = await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  });
  if (offices.length !== 1) throw new Error(`Expected one active Head Office; found ${offices.length}.`);
  const office = offices[0];

  const destinations = await prisma.site.findMany({
    where: { name: { equals: "JK JAIN / RAHUL JAIN", mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  });
  if (destinations.length !== 1) {
    throw new Error(`Expected one active JK Jain / Rahul Jain site; found ${destinations.length}.`);
  }
  const pushpanjali = destinations[0];

  const day30 = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: AMARYLLIS_ROUTE_DATE },
    orderBy: { sequence: "asc" },
  });
  const day31 = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: CONTINUATION_DATE },
    orderBy: { sequence: "asc" },
    include: { toSite: { select: { id: true, name: true, address: true, latitude: true, longitude: true } } },
  });

  const existingAmaryllis = day30.find(
    (journey) =>
      journey.fromSiteId === office.id &&
      journey.toName?.toLowerCase().includes("amaryllis"),
  );
  if (day30.length > 0 && !existingAmaryllis) {
    throw new Error(`October 30 already has a different journey; refusing to alter the trip sequence.`);
  }

  const amaryllisJourney = day31.find((journey) => journey.toName === AMARYLLIS_NAME);
  if (!amaryllisJourney) throw new Error("Yogesh has no October 31 Amaryllis trip to continue from.");
  const lastJourney = day31.at(-1);
  if (!lastJourney) throw new Error("Yogesh has no October 31 location to continue from.");
  if (
    lastJourney.id !== amaryllisJourney.id &&
    !day31.some((journey) => journey.toSiteId === pushpanjali.id)
  ) {
    throw new Error(`October 31's last location is ${lastJourney.toName}; expected ${AMARYLLIS_NAME}.`);
  }

  const existingPushpanjali = day31.find((journey) => journey.toSiteId === pushpanjali.id);
  if (existingPushpanjali && existingPushpanjali.sequence <= amaryllisJourney.sequence) {
    throw new Error("The Pushpanjali entry exists before the Amaryllis visit; refusing to reorder history.");
  }

  const from = {
    name: amaryllisJourney.toName,
    address: amaryllisJourney.toAddress,
    latitude: amaryllisJourney.toLat,
    longitude: amaryllisJourney.toLng,
  };
  if (!from.name || from.latitude == null || from.longitude == null) {
    throw new Error("Yogesh's last October 31 location is missing coordinates.");
  }

  const settings = await getSettings();
  const vehicleType = lastJourney.vehicleType as VehicleType;
  const amaryllisCache = await prisma.distanceCache.findUnique({
    where: {
      key: routeCacheKey(
        { latitude: office.latitude, longitude: office.longitude },
        { latitude: from.latitude, longitude: from.longitude },
      ),
    },
  });
  if (!amaryllisCache || amaryllisCache.source === "HAVERSINE") {
    throw new Error("No measured road-distance cache exists for Head Office to The Amaryllis.");
  }

  const oct30Amount = computeLegAmount(amaryllisCache.roadKm, vehicleType, settings.rates);
  const oct31Amount = computeLegAmount(PUSHPANJALI_DISTANCE_KM, vehicleType, settings.rates);
  const oct31HaversineKm =
    Math.round(
      haversineMeters(
        { lat: from.latitude, lng: from.longitude },
        { lat: pushpanjali.latitude, lng: pushpanjali.longitude },
      ) / 10,
    ) / 100;

  console.table([
    {
      employee: employee.name,
      date: AMARYLLIS_ROUTE_DATE,
      route: `${office.name} -> ${AMARYLLIS_NAME}`,
      distanceKm: amaryllisCache.roadKm,
      amount: oct30Amount,
      vehicleType,
      source: "CACHE",
      action: existingAmaryllis ? "already exists" : APPLY ? "add" : "dry run",
    },
    {
      employee: employee.name,
      date: CONTINUATION_DATE,
      route: `${from.name} -> ${pushpanjali.name}`,
      distanceKm: PUSHPANJALI_DISTANCE_KM,
      amount: oct31Amount,
      vehicleType,
      source: "MANUAL",
      action: existingPushpanjali ? "already exists" : APPLY ? "add" : "dry run",
    },
  ]);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add the missing entries.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const txDay30 = await tx.journey.findMany({
      where: { employeeId: employee.id, workDate: AMARYLLIS_ROUTE_DATE },
      select: { id: true, fromSiteId: true, toName: true },
    });
    const txAmaryllis = txDay30.find(
      (journey) =>
        journey.fromSiteId === office.id &&
        journey.toName?.toLowerCase().includes("amaryllis"),
    );
    if (txDay30.length > 0 && !txAmaryllis) {
      throw new Error("October 30 changed since the dry run; no entries were added.");
    }

    if (!txAmaryllis) {
      const created = await tx.journey.create({
        data: {
          employeeId: employee.id,
          workDate: AMARYLLIS_ROUTE_DATE,
          fromSiteId: office.id,
          fromName: office.name,
          toName: AMARYLLIS_NAME,
          fromAddress: office.address,
          toAddress: from.address,
          fromLat: office.latitude,
          fromLng: office.longitude,
          toLat: from.latitude,
          toLng: from.longitude,
          locationType: lastJourney.locationType,
          sequence: 0,
          distanceKm: amaryllisCache.roadKm,
          roadKm: amaryllisCache.roadKm,
          haversineKm: amaryllisCache.haversineKm,
          durationMin: amaryllisCache.durationMin,
          source: "CACHE",
          vehicleType,
          amount: oct30Amount,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CREATE",
          entity: "Journey",
          entityId: created.id,
          meta: JSON.stringify({
            source: "admin-entry-script",
            employeeId: employee.id,
            workDate: AMARYLLIS_ROUTE_DATE,
            route: `${office.name} -> ${AMARYLLIS_NAME}`,
            distanceKm: amaryllisCache.roadKm,
          }),
        },
      });
    }

    const txDay31 = await tx.journey.findMany({
      where: { employeeId: employee.id, workDate: CONTINUATION_DATE },
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true, toSiteId: true, toName: true },
    });
    const txExistingTarget = txDay31.find((journey) => journey.toSiteId === pushpanjali.id);
    if (!txExistingTarget) {
      const txLast = txDay31.at(-1);
      if (!txLast || txLast.toName !== AMARYLLIS_NAME) {
        throw new Error("October 31 changed since the dry run; no continuation was added.");
      }
      const created = await tx.journey.create({
        data: {
          employeeId: employee.id,
          workDate: CONTINUATION_DATE,
          fromName: from.name,
          toName: pushpanjali.name,
          fromAddress: from.address,
          toAddress: pushpanjali.address,
          fromLat: from.latitude,
          fromLng: from.longitude,
          toLat: pushpanjali.latitude,
          toLng: pushpanjali.longitude,
          toSiteId: pushpanjali.id,
          locationType: "MASTER",
          manualDistance: true,
          manualReason: "Distance supplied by administrator.",
          sequence: txLast.sequence + 1,
          loginAt: lastJourney.loginAt,
          distanceKm: PUSHPANJALI_DISTANCE_KM,
          roadKm: null,
          haversineKm: oct31HaversineKm,
          durationMin: null,
          source: "MANUAL",
          vehicleType,
          amount: oct31Amount,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CREATE",
          entity: "Journey",
          entityId: created.id,
          meta: JSON.stringify({
            source: "admin-entry-script",
            employeeId: employee.id,
            workDate: CONTINUATION_DATE,
            route: `${from.name} -> ${pushpanjali.name}`,
            distanceKm: PUSHPANJALI_DISTANCE_KM,
            manualDistance: true,
          }),
        },
      });
    }
  });

  console.log("Requested Yogesh entries added or already present.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
