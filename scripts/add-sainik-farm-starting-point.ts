/**
 * Add Sainik Farm as an employee starting point, alongside the head office
 * and Watcon Showroom.
 *
 * Run without --apply to preview. Re-running after a successful apply is safe.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const LOCATION = {
  name: "Sainik Farm",
  address: "119, Anupam Garden, Lane No. 3, Country Club Road, Mehrauli, South Delhi, Delhi - 110030",
  pincode: "110030",
  city: "New Delhi",
  state: "Delhi",
  region: "Delhi NCR",
  zone: "South Delhi",
  latitude: 28.512451,
  longitude: 77.208167,
  geofenceRadius: 200,
  isOffice: false,
  isStartingPoint: true,
  status: "ACTIVE",
} as const;

function nextSiteCode(codes: string[]): string {
  const highest = codes.reduce((max, code) => {
    const match = /^SITE-(\d+)$/.exec(code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `SITE-${String(highest + 1).padStart(3, "0")}`;
}

async function main() {
  const sites = await prisma.site.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      address: true,
      isStartingPoint: true,
      status: true,
    },
  });

  const existing = sites.find((site) =>
    site.name.trim().toLowerCase() === LOCATION.name.toLowerCase() ||
    site.address.trim().toLowerCase() === LOCATION.address.toLowerCase(),
  );

  if (existing) {
    const alreadyCorrect = existing.name === LOCATION.name &&
      existing.address === LOCATION.address &&
      existing.isStartingPoint &&
      existing.status === "ACTIVE";
    if (alreadyCorrect) {
      console.log(`${existing.code} already contains the active Sainik Farm starting point; no changes needed.`);
      return;
    }
    throw new Error(
      `A matching location already exists but differs from the requested starting point:\n${JSON.stringify(existing, null, 2)}`,
    );
  }

  const code = nextSiteCode(sites.map((site) => site.code));
  console.table([{ code, ...LOCATION }]);

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to create this starting point.");
    return;
  }

  await prisma.site.create({ data: { code, ...LOCATION } });
  console.log(`Created ${code}: ${LOCATION.name} as an active starting point.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
