import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const sites = await p.site.findMany({
    where: { name: { contains: "SITARAM", mode: "insensitive" } },
    select: { id: true, code: true, name: true, address: true, status: true, latitude: true, longitude: true, updatedAt: true },
  });
  console.log(JSON.stringify(sites, null, 2));
  await p.$disconnect();
})();
