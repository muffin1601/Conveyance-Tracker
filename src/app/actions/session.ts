"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { EMP_COOKIE } from "@/lib/auth";

/**
 * Remembers which employee is using this device.
 *
 * The app has no password login — anyone can pick any name from the roster —
 * so this is a CONVENIENCE, not an access control boundary. Its job is to stop
 * the Check In page showing every colleague's trips and expenses to whoever
 * happens to open it, and to keep your own name selected across a refresh.
 *
 * Anything that genuinely must be restricted (the Admin view, exports) stays
 * behind the separate PIN gate.
 */

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days — a shared work phone still forgets eventually

export async function setActiveEmployee(employeeId: string): Promise<{ ok: boolean }> {
  const jar = await cookies();

  if (!employeeId) {
    jar.delete(EMP_COOKIE);
    return { ok: true };
  }

  // Only accept an id that is a real, active employee, so a stale or hand-set
  // cookie can never scope the page to something that does not exist.
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!employee || employee.deletedAt || employee.status !== "ACTIVE") {
    jar.delete(EMP_COOKIE);
    return { ok: false };
  }

  jar.set(EMP_COOKIE, employee.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return { ok: true };
}

/** The employee this device last identified as, if any. */
export async function getActiveEmployeeId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(EMP_COOKIE)?.value ?? null;
}
