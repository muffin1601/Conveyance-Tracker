"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANG_COOKIE, DEFAULT_LANG, isLang, type Lang } from "@/lib/i18n";

/**
 * Which language this device reads the Check In page in. Stored in a plain
 * cookie (same pattern as the remembered-employee cookie in actions/session.ts)
 * so the server component renders the right language on the very first
 * paint — no flash of English before a client toggle can react.
 */

const MAX_AGE = 60 * 60 * 24 * 365; // a year — a language choice should stick

export async function setLanguage(lang: Lang): Promise<{ ok: boolean }> {
  if (!isLang(lang)) return { ok: false };
  const jar = await cookies();
  jar.set(LANG_COOKIE, lang, {
    httpOnly: false, // read client-side too, so the toggle can reflect state without a round-trip
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  revalidatePath("/app");
  return { ok: true };
}

export async function getLanguage(): Promise<Lang> {
  const jar = await cookies();
  const v = jar.get(LANG_COOKIE)?.value;
  return isLang(v) ? v : DEFAULT_LANG;
}
