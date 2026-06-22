"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireRole } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";
import { APPROVAL_FLOW, type ClaimStatus } from "@/lib/enums";
import { monthKey } from "@/lib/utils";

/**
 * Build (or refresh) the monthly claim for the current employee from all
 * journeys in the period that are not yet attached to a claim item. Idempotent.
 */
export async function buildMonthlyClaim(period?: string) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("No employee profile.");
  const periodMonth = period ?? monthKey();

  const journeys = await prisma.journey.findMany({
    where: { employeeId: user.employeeId, workDate: { startsWith: periodMonth } },
    include: { claimItem: true },
  });
  if (journeys.length === 0) throw new Error("No journeys to claim for this period.");

  const claim = await prisma.claim.upsert({
    where: { employeeId_periodMonth: { employeeId: user.employeeId, periodMonth } },
    create: { employeeId: user.employeeId, periodMonth, status: "DRAFT" },
    update: {},
  });
  if (claim.status !== "DRAFT" && claim.status !== "REJECTED") {
    throw new Error("Claim for this period has already been submitted.");
  }

  let totalKm = 0;
  let totalAmount = 0;
  for (const j of journeys) {
    totalKm += j.distanceKm;
    totalAmount += j.amount;
    if (!j.claimItem) {
      await prisma.claimItem.create({
        data: { claimId: claim.id, journeyId: j.id, km: j.distanceKm, amount: j.amount },
      });
    }
  }

  await prisma.claim.update({
    where: { id: claim.id },
    data: { totalKm: +totalKm.toFixed(2), totalAmount: +totalAmount.toFixed(2), status: "DRAFT" },
  });

  await audit({ userId: user.id, action: "UPDATE", entity: "Claim", entityId: claim.id, meta: { totalKm, totalAmount } });
  revalidatePath("/app/claims");
  return { ok: true, totalKm, totalAmount };
}

export async function submitClaim(claimId: string) {
  const user = await requireUser();
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { employee: true } });
  if (!claim || claim.employee.userId !== user.id) throw new Error("Claim not found.");
  if (!["DRAFT", "REJECTED"].includes(claim.status)) throw new Error("Already submitted.");

  await prisma.claim.update({
    where: { id: claimId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  await audit({ userId: user.id, action: "UPDATE", entity: "Claim", entityId: claimId, meta: { status: "SUBMITTED" } });

  // Notify the manager.
  const mgr = await prisma.employee.findUnique({
    where: { id: claim.employee.managerId ?? "" },
    select: { userId: true },
  });
  if (mgr?.userId) {
    await notify({
      userId: mgr.userId,
      type: "APPROVAL_PENDING",
      title: "Conveyance claim pending",
      body: `${claim.employee.name} submitted a claim for ${claim.periodMonth}.`,
      link: "/app/approvals",
    });
  }
  revalidatePath("/app/claims");
  return { ok: true };
}

const decisionSchema = z.object({
  claimId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().optional(),
});

/**
 * Advance a claim through the approval ladder
 * (Manager → Admin → Finance → Paid). RBAC enforced per stage.
 */
export async function decideClaim(input: z.infer<typeof decisionSchema>) {
  const { claimId, decision, note } = decisionSchema.parse(input);
  const user = await requireRole("MANAGER");
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { employee: true } });
  if (!claim) throw new Error("Claim not found.");

  const flow = APPROVAL_FLOW[claim.status];
  if (!flow) throw new Error(`Claim is not awaiting approval (status ${claim.status}).`);

  // Stage gating: MANAGER stage needs MANAGER+, ADMIN/FINANCE need ADMIN+.
  if (flow.stage !== "MANAGER" && user.role === "MANAGER") {
    throw new Error("This stage requires an Admin.");
  }

  const nextStatus: ClaimStatus = decision === "REJECTED" ? "REJECTED" : flow.next;

  await prisma.$transaction([
    prisma.approval.create({
      data: { claimId, actorId: user.id, stage: flow.stage, decision, note: note ?? null },
    }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: nextStatus, ...(nextStatus === "PAID" ? { paidAt: new Date() } : {}) },
    }),
  ]);

  await audit({ userId: user.id, action: "APPROVE", entity: "Claim", entityId: claimId, meta: { decision, stage: flow.stage } });

  if (claim.employee.userId) {
    await notify({
      userId: claim.employee.userId,
      type: decision === "REJECTED" ? "CLAIM_REJECTED" : "CLAIM_APPROVED",
      title: decision === "REJECTED" ? "Claim rejected" : `Claim ${flow.stage.toLowerCase()}-approved`,
      body: `Your ${claim.periodMonth} claim is now ${nextStatus}.`,
      link: "/app/claims",
    });
  }
  revalidatePath("/app/approvals");
  revalidatePath("/app/claims");
  return { ok: true, status: nextStatus };
}
