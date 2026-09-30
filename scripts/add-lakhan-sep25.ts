import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-09-25";
const EMPLOYEE_NAME = "Lakhan Kumar";

const STOPS = [
  {
    name: "Goverdhan House, Nehru Place",
    address: "Goverdhan House, 53-54, Nehru Place Road, Nehru Place, New Delhi, Delhi 110019, India",
    city: "New Delhi",
    state: "Delhi",
    country: "India",
    postalCode: "110019",
    latitude: 28.548817,
    longitude: 77.2516503,
  },
  {
    name: "Rampuri, Govindpuri",
    address: "Rampuri, Govindpuri, Kalkaji, New Delhi, Delhi 110076, India",
    city: "New Delhi",
    state: "Delhi",
    country: "India",
    postalCode: "110076",
    latitude: 28.5371808,
    longitude: 77.2617579,
  },
] as const;

type Point = {
  siteId: string | null;
  customLocationId: string | null;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function haversineKm(from: Point, to: Point): number {
  const earthKm = 6371;
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

function route(from: Point, to: Point) {
  const straightKm = haversineKm(from, to);
  const distanceKm = Math.round(straightKm * 1.3 * 100) / 100;
  return {
    distanceKm,
    roadKm: null,
    haversineKm: straightKm,
    durationMin: Math.max(1, Math.round((distanceKm / 24) * 60)),
    source: "HAVERSINE",
  };
}

async function main() {
  const employee = await prisma.employee.findFirstOrThrow({
    where: { name: { equals: EMPLOYEE_NAME, mode: "insensitive" } },
    select: { id: true, name: true, vehicleType: true, lastLoginAt: true, defaultOriginSiteId: true },
  });
  const vehicleType = employee.vehicleType === "CAR" ? "CAR" : "BIKE";

  const [office, defaultOrigin, settingsRow, existing] = await Promise.all([
    prisma.site.findFirstOrThrow({ where: { isOffice: true } }),
    employee.defaultOriginSiteId
      ? prisma.site.findUnique({ where: { id: employee.defaultOriginSiteId } })
      : Promise.resolve(null),
    prisma.setting.findUnique({ where: { key: "company" } }),
    prisma.journey.findMany({
      where: { employeeId: employee.id, workDate: WORK_DATE },
      orderBy: { sequence: "asc" },
      select: {
        id: true, sequence: true, fromName: true, toName: true, toAddress: true,
        toLat: true, toLng: true, toSiteId: true, toCustomLocationId: true,
        distanceKm: true, amount: true, createdAt: true,
        toSite: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
        toCustomLocation: { select: { id: true, locationName: true, address: true, latitude: true, longitude: true } },
      },
    }),
  ]);

  let rate = vehicleType === "CAR" ? 11 : 4;
  if (settingsRow) {
    try {
      const parsed = JSON.parse(settingsRow.value) as { rates?: Record<string, number> };
      rate = parsed.rates?.[vehicleType] ?? rate;
    } catch {
      // Keep the documented default when a legacy settings row is malformed.
    }
  }

  const originSite = defaultOrigin ?? office;
  const last = existing.at(-1);
  let from: Point = last
    ? {
        siteId: last.toSiteId,
        customLocationId: last.toCustomLocationId,
        name: last.toName ?? last.toSite?.name ?? last.toCustomLocation?.locationName ?? "Previous destination",
        address: last.toAddress ?? last.toSite?.address ?? last.toCustomLocation?.address ?? null,
        latitude: last.toLat ?? last.toSite?.latitude ?? last.toCustomLocation?.latitude ?? originSite.latitude,
        longitude: last.toLng ?? last.toSite?.longitude ?? last.toCustomLocation?.longitude ?? originSite.longitude,
      }
    : {
        siteId: originSite.id,
        customLocationId: null,
        name: originSite.name,
        address: originSite.address,
        latitude: originSite.latitude,
        longitude: originSite.longitude,
      };

  const alreadyPresent = (stop: (typeof STOPS)[number]) => existing.some((journey) => {
    const lat = journey.toLat ?? journey.toSite?.latitude ?? journey.toCustomLocation?.latitude;
    const lng = journey.toLng ?? journey.toSite?.longitude ?? journey.toCustomLocation?.longitude;
    return lat != null && lng != null && Math.abs(lat - stop.latitude) < 0.0001 && Math.abs(lng - stop.longitude) < 0.0001;
  });

  const plan: Array<{ stop: (typeof STOPS)[number]; from: Point; route: ReturnType<typeof route> }> = [];
  for (const stop of STOPS) {
    if (alreadyPresent(stop)) continue;
    const to: Point = {
      siteId: null,
      customLocationId: null,
      name: stop.name,
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
    };
    plan.push({ stop, from, route: route(from, to) });
    from = to;
  }

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    employee: employee.name,
    workDate: WORK_DATE,
    vehicleType,
    rate,
    existing: existing.map((row) => ({
      sequence: row.sequence, from: row.fromName, to: row.toName,
      distanceKm: row.distanceKm, amount: row.amount, createdAt: row.createdAt,
    })),
    planned: plan.map((item) => ({
      from: item.from.name,
      to: item.stop.name,
      address: item.stop.address,
      ...item.route,
      amount: Math.round(item.route.distanceKm * rate * 100) / 100,
    })),
  }, null, 2));

  if (!APPLY || plan.length === 0) return;

  let sequence = (last?.sequence ?? -1) + 1;
  let createdAt = last?.createdAt
    ? new Date(last.createdAt.getTime() + 60 * 60 * 1000)
    : new Date("2026-09-25T12:00:00+05:30");

  for (const item of plan) {
    const custom = await prisma.userCustomLocation.findFirst({
      where: {
        employeeId: employee.id,
        latitude: { gte: item.stop.latitude - 0.0001, lte: item.stop.latitude + 0.0001 },
        longitude: { gte: item.stop.longitude - 0.0001, lte: item.stop.longitude + 0.0001 },
      },
    }) ?? await prisma.userCustomLocation.create({
      data: {
        employeeId: employee.id,
        loginAt: employee.lastLoginAt,
        locationName: item.stop.name,
        address: item.stop.address,
        city: item.stop.city,
        state: item.stop.state,
        country: item.stop.country,
        postalCode: item.stop.postalCode,
        latitude: item.stop.latitude,
        longitude: item.stop.longitude,
        source: "GPS",
      },
    });

    const amount = Math.round(item.route.distanceKm * rate * 100) / 100;
    const created = await prisma.journey.create({
      data: {
        employeeId: employee.id,
        workDate: WORK_DATE,
        sequence,
        fromSiteId: item.from.siteId,
        fromCustomLocationId: item.from.customLocationId,
        toCustomLocationId: custom.id,
        fromName: item.from.name,
        toName: item.stop.name,
        fromAddress: item.from.address,
        toAddress: item.stop.address,
        fromLat: item.from.latitude,
        fromLng: item.from.longitude,
        toLat: item.stop.latitude,
        toLng: item.stop.longitude,
        locationType: "GPS",
        loginAt: employee.lastLoginAt,
        manualDistance: false,
        distanceKm: item.route.distanceKm,
        roadKm: item.route.roadKm,
        haversineKm: item.route.haversineKm,
        durationMin: item.route.durationMin,
        source: item.route.source,
        vehicleType,
        amount,
        createdAt,
      },
      select: { id: true, sequence: true, fromName: true, toName: true, toAddress: true, distanceKm: true, amount: true },
    });
    console.log(JSON.stringify({ created }, null, 2));
    item.from.customLocationId = custom.id;
    sequence += 1;
    createdAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
