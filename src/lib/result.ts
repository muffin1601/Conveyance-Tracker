/**
 * Result type for server actions.
 *
 * Next.js deliberately REDACTS errors thrown inside a server action in a
 * production build: the server logs the real message, the browser receives
 * only a 500 and an opaque digest. A carefully written message like
 * "this trip belongs to a paid claim" therefore never reaches the person who
 * needs it, and the UI looks like the button simply does nothing.
 *
 * So any failure a user is expected to act on is RETURNED, not thrown. Throwing
 * is reserved for genuine programming errors, where redaction is the right
 * behaviour anyway.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, data } as ActionResult<T>;
}

export function fail<T = void>(error: string): ActionResult<T> {
  return { ok: false, error };
}

/**
 * Run a server action body, turning an expected failure into a returned error.
 * `expected` marks messages that were written for the user; anything else is
 * logged server-side and reported generically so internals never leak.
 */
export async function attempt<T>(
  run: () => Promise<ActionResult<T>>,
  context: string,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (e) {
    console.error(`[${context}]`, e);
    return {
      ok: false,
      error: "Something went wrong. Please try again — if it keeps happening, contact your administrator.",
    };
  }
}
