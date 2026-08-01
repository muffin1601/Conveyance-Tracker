import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";

/**
 * Master data for the pickers — the employee roster and the site list.
 *
 * These are read on every single page render but change only when HR or an
 * admin edits them (never from inside this app's UI). Each read is a ~450 ms
 * round-trip to the pooled database, so they are cached across requests and
 * revalidated on a timer. `MASTER_DATA_TAG` lets any future mutation flush
 * them immediately via `revalidateTag`.
 */

export const MASTER_DATA_TAG = "master-data";
const REVALIDATE_SECONDS = 300;

export interface EmployeeOption {
  id: string;
  name: string;
  designation: string;
  department: string;
}

export interface SiteOption {
  id: string;
  name: string;
  city: string | null;
  address: string;
}

export const getActiveEmployees = unstable_cache(
  async (): Promise<EmployeeOption[]> =>
    prisma.employee.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, designation: true, department: true },
    }),
  ["active-employees"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);

export const getActiveSites = unstable_cache(
  async (): Promise<SiteOption[]> =>
    prisma.site.findMany({
      where: { status: "ACTIVE", isOffice: false, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, address: true },
    }),
  ["active-sites"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);

export const getHeadOffice = unstable_cache(
  async (): Promise<{ name: string; address: string } | null> =>
    prisma.site.findFirst({ where: { isOffice: true }, select: { name: true, address: true } }),
  ["head-office"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);
