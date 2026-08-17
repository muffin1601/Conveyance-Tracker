import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { ROLE_RANK, type Role } from "./enums";

const COOKIE = "watcon_session";
const DAY = 60 * 60 * 24;
const MAX_AGE = 7 * DAY;

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET || "dev-secret-change-me-to-a-long-random-string-min-32";
  return new TextEncoder().encode(s);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  employeeId: string | null;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** Authenticate credentials and create a DB-backed session + signed cookie. */
export async function login(email: string, password: string): Promise<SessionUser> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { employee: true },
  });
  if (!user || !user.isActive || user.deletedAt) throw new Error("Invalid credentials");
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  const hdrs = await headers();
  const token = await new SignJWT({ uid: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  await prisma.session.create({
    data: {
      userId: user.id,
      token,
      ip: hdrs.get("x-forwarded-for") ?? null,
      userAgent: hdrs.get("user-agent") ?? null,
      expiresAt: new Date(Date.now() + MAX_AGE * 1000),
    },
  });
  const loginAt = new Date();
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: loginAt } });
  // Keep the employee-side login time in step for accounts that have a linked
  // staff record, so a password login stamps location records the same way
  // picking your name on /app does.
  if (user.employee) {
    await prisma.employee.update({ where: { id: user.employee.id }, data: { lastLoginAt: loginAt } });
  }

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    employeeId: user.employee?.id ?? null,
  };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  jar.delete(COOKIE);
}

/** Cookie holding the currently-selected employee id (no password — open access). */
export const EMP_COOKIE = "watcon_employee";

/**
 * Returns the active "session" user based on the selected employee (no login).
 * Anyone can pick their name; role is inherited from a linked account if one
 * exists, otherwise defaults to EMPLOYEE.
 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const empId = jar.get(EMP_COOKIE)?.value;
  if (!empId) return null;
  const emp = await prisma.employee.findUnique({
    where: { id: empId },
    include: { user: true },
  });
  if (!emp || emp.deletedAt || emp.status !== "ACTIVE") return null;
  return {
    id: emp.user?.id ?? emp.id,
    email: emp.user?.email ?? emp.email ?? "",
    name: emp.name,
    role: (emp.user?.role as Role) ?? "EMPLOYEE",
    employeeId: emp.id,
  };
}

/** Throws if not logged in. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSession();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

/** Throws unless the user's role meets or exceeds `min`. */
export async function requireRole(min: Role): Promise<SessionUser> {
  const u = await requireUser();
  if (ROLE_RANK[u.role] < ROLE_RANK[min]) throw new Error("FORBIDDEN");
  return u;
}

export function can(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
