"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveSettings, type CompanySettings } from "@/lib/settings";

const siteSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  address: z.string().min(2),
  pincode: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  client: z.string().optional(),
  projectManager: z.string().optional(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  geofenceRadius: z.coerce.number().min(50).max(2000),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function upsertSite(input: z.infer<typeof siteSchema>) {
  const user = await requireRole("ADMIN");
  const d = siteSchema.parse(input);
  if (d.id) {
    await prisma.site.update({ where: { id: d.id }, data: d });
    await audit({ userId: user.id, action: "UPDATE", entity: "Site", entityId: d.id });
  } else {
    const count = await prisma.site.count();
    await prisma.site.create({
      data: { ...d, code: `SITE-${String(count + 1).padStart(3, "0")}` },
    });
    await audit({ userId: user.id, action: "CREATE", entity: "Site" });
  }
  revalidatePath("/app/sites");
  return { ok: true };
}

export async function deleteSite(id: string) {
  const user = await requireRole("ADMIN");
  await prisma.site.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
  await audit({ userId: user.id, action: "DELETE", entity: "Site", entityId: id });
  revalidatePath("/app/sites");
  return { ok: true };
}

const empSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  department: z.string().min(1),
  designation: z.string().min(1),
  vehicleType: z.enum(["BIKE", "CAR", "CAB", "AUTO", "METRO", "BUS"]),
  managerId: z.string().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export async function upsertEmployee(input: z.infer<typeof empSchema>) {
  const user = await requireRole("ADMIN");
  const d = empSchema.parse(input);
  const data = {
    name: d.name,
    phone: d.phone || null,
    email: d.email || null,
    department: d.department,
    designation: d.designation,
    vehicleType: d.vehicleType,
    managerId: d.managerId || null,
    status: d.status,
  };
  if (d.id) {
    await prisma.employee.update({ where: { id: d.id }, data });
    await audit({ userId: user.id, action: "UPDATE", entity: "Employee", entityId: d.id });
  } else {
    const count = await prisma.employee.count();
    await prisma.employee.create({
      data: { ...data, employeeCode: `WAT-${String(count + 1).padStart(4, "0")}` },
    });
    await audit({ userId: user.id, action: "CREATE", entity: "Employee" });
  }
  revalidatePath("/app/employees");
  return { ok: true };
}

export async function saveCompanySettings(settings: CompanySettings) {
  const user = await requireRole("SUPER_ADMIN");
  await saveSettings(settings);
  await audit({ userId: user.id, action: "UPDATE", entity: "Setting", entityId: "company" });
  revalidatePath("/app/settings");
  return { ok: true };
}
