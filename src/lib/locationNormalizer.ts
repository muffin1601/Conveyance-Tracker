/**
 * Location Normalization Service
 *
 * Normalizes location names and route identifiers to prevent duplicate route
 * records caused by spelling variations, abbreviations, punctuation differences,
 * and Roman numerals (e.g. "Phase II" vs "Phase 2").
 */

/**
 * Standardize and normalize a single location name.
 */
export function normalizeLocationName(name: string | null | undefined): string {
  if (!name || typeof name !== "string") return "";

  let s = name.toLowerCase().trim();

  // Normalize Unicode dashes, hyphens, and quotes
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');

  // Head office canonicalization (Watcon International - Head Office / Head Office)
  s = s.replace(/\bwatcon\s+international\s*[-–—]?\s*head\s+office\b/gi, "head office");
  s = s.replace(/\bwatcon\s+head\s+office\b/gi, "head office");

  // Common Indian location typos & alternate spellings
  s = s.replace(/\bgrurugram\b/gi, "gurugram");
  s = s.replace(/\bgurgaon\b/gi, "gurugram");
  s = s.replace(/\bnew\s+delhi\b/gi, "delhi");
  s = s.replace(/\bchhattarpur\b/gi, "chattarpur");

  // Roman numerals in phases, sectors, blocks (e.g. "Phase - II" -> "phase 2")
  s = s.replace(/\bphase\s*[-–—]?\s*i\b/gi, "phase 1");
  s = s.replace(/\bphase\s*[-–—]?\s*ii\b/gi, "phase 2");
  s = s.replace(/\bphase\s*[-–—]?\s*iii\b/gi, "phase 3");
  s = s.replace(/\bphase\s*[-–—]?\s*iv\b/gi, "phase 4");
  s = s.replace(/\bphase\s*[-–—]?\s*v\b/gi, "phase 5");
  s = s.replace(/\bphase\s*[-–—]?\s*vi\b/gi, "phase 6");

  s = s.replace(/\bblock\s*[-–—]?\s*i\b/gi, "block 1");
  s = s.replace(/\bblock\s*[-–—]?\s*ii\b/gi, "block 2");
  s = s.replace(/\bblock\s*[-–—]?\s*iii\b/gi, "block 3");

  // Abbreviations
  s = s.replace(/\bsec\b/gi, "sector");
  s = s.replace(/\bsec[-–—.](\d+)\b/gi, "sector $1");
  s = s.replace(/\brd\b/gi, "road");
  s = s.replace(/\bmkt\b/gi, "market");
  s = s.replace(/\bext\b/gi, "extension");
  s = s.replace(/\bapt\b/gi, "apartment");
  s = s.replace(/\bapts\b/gi, "apartments");
  s = s.replace(/\bsoc\b/gi, "society");
  s = s.replace(/\bopp\b/gi, "opposite");
  s = s.replace(/\bnr\b/gi, "near");
  s = s.replace(/\bho\b/gi, "head office");

  // Remove punctuation, commas, dots, slashes, brackets
  s = s.replace(/[,;:.()\/\\_#\-+*&]/g, " ");

  // Collapse multiple whitespace characters
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Builds a deterministic, directional route key for a From -> To pair.
 * Routes are directional by default: A -> B and B -> A are separate keys.
 */
export function buildRouteKey(
  from: string | { name?: string | null; siteId?: string | null },
  to: string | { name?: string | null; siteId?: string | null }
): {
  routeKey: string;
  fromNormalized: string;
  toNormalized: string;
} {
  const fromName = typeof from === "string" ? from : from.name ?? "";
  const toName = typeof to === "string" ? to : to.name ?? "";

  const fromNormalized = normalizeLocationName(fromName);
  const toNormalized = normalizeLocationName(toName);

  const routeKey = `${fromNormalized}:::${toNormalized}`;

  return { routeKey, fromNormalized, toNormalized };
}
