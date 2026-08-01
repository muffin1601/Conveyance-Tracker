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

/**
 * Every selectable destination — including the head office and any other
 * starting-point site (e.g. a showroom). These used to exclude isOffice
 * sites on the assumption nobody would ever travel "to" the office, but a
 * return trip to HQ is a completely normal destination, so it belongs in the
 * same picker as everywhere else.
 */
export const getActiveSites = unstable_cache(
  async (): Promise<SiteOption[]> =>
    prisma.site.findMany({
      where: { status: "ACTIVE", deletedAt: null },
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

export interface StartingPointOption {
  id: string;
  name: string;
  isOffice: boolean;
}

/**
 * Sites an employee may be assigned as their personal day-start, for the
 * Settings → Staff picker. Head Office is always included (it is every
 * employee's default) alongside anything else flagged `isStartingPoint`.
 */
export const getStartingPointSites = unstable_cache(
  async (): Promise<StartingPointOption[]> =>
    prisma.site.findMany({
      where: { status: "ACTIVE", deletedAt: null, OR: [{ isOffice: true }, { isStartingPoint: true }] },
      orderBy: [{ isOffice: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isOffice: true },
    }),
  ["starting-point-sites"],
  { tags: [MASTER_DATA_TAG], revalidate: REVALIDATE_SECONDS },
);
