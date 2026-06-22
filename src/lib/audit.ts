import "server-only";
import { headers } from "next/headers";
import { prisma } from "./prisma";

export async function audit(params: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  let ip: string | null = null;
  try {
    ip = (await headers()).get("x-forwarded-for");
  } catch {
    /* outside request scope */
  }
  await prisma.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      meta: params.meta ? JSON.stringify(params.meta) : null,
      ip,
    },
  });
}

export async function notify(params: {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
}): Promise<void> {
  await prisma.notification.create({ data: params });
  // Email / Web Push fan-out hooks here (Resend / push). No-op without keys.
}
