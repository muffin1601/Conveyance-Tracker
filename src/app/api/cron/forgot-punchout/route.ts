import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { notify } from "@/lib/audit";

/**
 * Scheduled job (Vercel Cron): flag visits left open beyond the configured
 * threshold and notify the employee to punch out. Protect with CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.forgotPunchoutHours * 3600 * 1000);

  const stale = await prisma.siteVisit.findMany({
    where: { status: "OPEN", checkInAt: { lt: cutoff } },
    include: { employee: { select: { userId: true, name: true } }, site: true },
  });

  let notified = 0;
  for (const v of stale) {
    if (!v.employee.userId) continue;
    await notify({
      userId: v.employee.userId,
      type: "FORGOT_PUNCHOUT",
      title: "You forgot to punch out",
      body: `Your visit at ${v.site.name} is still open. Please punch out.`,
      link: "/app/checkin",
    });
    notified++;
  }

  return NextResponse.json({ ok: true, scanned: stale.length, notified });
}
