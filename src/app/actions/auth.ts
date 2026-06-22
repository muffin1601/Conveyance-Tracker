"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function loginAction(_prev: unknown, formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  try {
    const user = await login(parsed.data.email, parsed.data.password);
    await audit({ userId: user.id, action: "LOGIN", entity: "Session" });
  } catch {
    return { error: "Invalid email or password." };
  }
  redirect("/app");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
