"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { MISC_CATEGORIES } from "@/lib/enums";
import { isSettingsUnlocked } from "./settings";
import { purgeBillObject, auditBill } from "./bills";

export async function listMiscExpenses(employeeId: string, workDate?: string) {
  if (!employeeId) return [];
  return prisma.miscellaneousExpense.findMany({
    where: { employeeId, ...(workDate ? { workDate } : {}) },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
  });
}

const billSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  size: z.number().int().positive(),
});

const inputSchema = z.object({
  employeeId: z.string().min(1, "Select your name."),
  category: z.enum(MISC_CATEGORIES),
  customCategory: z.string().trim().max(80).optional(),
  amount: z.coerce
    .number({ invalid_type_error: "Enter an amount." })
    .positive("Amount must be greater than zero.")
    .max(1_000_000, "Amount looks too large."),
  description: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date."),
  bill: billSchema.optional(), // newly-uploaded bill metadata
  removeBill: z.boolean().optional(), // edit: clear the existing bill
});

type Input = z.infer<typeof inputSchema>;

function validate(input: Input) {
  const v = inputSchema.parse(input);
  if (v.category === "OTHER" && !v.customCategory) {
    throw new Error("Enter a custom category for “Other”.");
  }
  return v;
}

function billFields(v: Input) {
  if (!v.bill) return {};
  return {
    billPath: v.bill.path,
    billName: v.bill.name,
    billType: v.bill.type,
    billSize: v.bill.size,
    billUploadedAt: new Date(),
    billUploadedBy: v.employeeId,
  };
}

const CLEARED_BILL = {
  billPath: null, billName: null, billType: null, billSize: null,
  billUploadedAt: null, billUploadedBy: null,
};

export async function addMiscExpense(input: Input) {
  const v = validate(input);
  const created = await prisma.miscellaneousExpense.create({
    data: {
      employeeId: v.employeeId,
      workDate: v.workDate,
      category: v.category,
      customCategory: v.category === "OTHER" ? v.customCategory ?? null : null,
      amount: Math.round(v.amount * 100) / 100,
      description: v.description || null,
      notes: v.notes || null,
      ...billFields(v),
    },
  });
  if (v.bill) {
    await auditBill({ employeeId: v.employeeId, action: "BILL_UPLOAD", entity: "MiscellaneousExpense", entityId: created.id, path: v.bill.path });
  }
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}

export async function updateMiscExpense(id: string, input: Input) {
  const v = validate(input);
  const existing = await prisma.miscellaneousExpense.findUnique({ where: { id } });
  if (!existing || existing.employeeId !== v.employeeId) {
    throw new Error("Expense not found.");
  }

  // Resolve the bill mutation: replace, remove, or keep.
  let billData: Record<string, unknown> = {};
  if (v.bill) {
    if (existing.billPath && existing.billPath !== v.bill.path) await purgeBillObject(existing.billPath);
    billData = billFields(v);
    await auditBill({ employeeId: v.employeeId, action: existing.billPath ? "BILL_REPLACE" : "BILL_UPLOAD", entity: "MiscellaneousExpense", entityId: id, path: v.bill.path });
  } else if (v.removeBill && existing.billPath) {
    await purgeBillObject(existing.billPath);
    billData = CLEARED_BILL;
    await auditBill({ employeeId: v.employeeId, action: "BILL_DELETE", entity: "MiscellaneousExpense", entityId: id, path: existing.billPath });
  }

  await prisma.miscellaneousExpense.update({
    where: { id },
    data: {
      workDate: v.workDate,
      category: v.category,
      customCategory: v.category === "OTHER" ? v.customCategory ?? null : null,
      amount: Math.round(v.amount * 100) / 100,
      description: v.description || null,
      notes: v.notes || null,
      ...billData,
    },
  });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}

export async function deleteMiscExpense(id: string, employeeId: string) {
  const existing = await prisma.miscellaneousExpense.findUnique({ where: { id } });
  if (!existing || existing.employeeId !== employeeId) {
    throw new Error("Expense not found.");
  }
  await prisma.miscellaneousExpense.delete({ where: { id } });
  await purgeBillObject(existing.billPath); // prevent orphaned storage
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}

/** Admin delete — not owner-restricted; gated by the admin PIN unlock. */
export async function adminDeleteMiscExpense(id: string) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const existing = await prisma.miscellaneousExpense.findUnique({ where: { id } });
  await prisma.miscellaneousExpense.delete({ where: { id } });
  await purgeBillObject(existing?.billPath);
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}

/** List miscellaneous expenses for a period, across all employees (admin). */
export async function listMiscForPeriod(period: string) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  return prisma.miscellaneousExpense.findMany({
    where: { workDate: { startsWith: period } },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { employee: { select: { name: true } } },
  });
}
