import "server-only";

/**
 * Bill attachments on Supabase Storage — PRIVATE bucket, server-brokered.
 *
 * Security model (this app has no Supabase Auth; identity lives at the app
 * layer): the browser never holds the service-role key and never talks to
 * Storage with long-lived credentials. Instead:
 *   • Uploads use a one-time SIGNED UPLOAD URL scoped to a server-chosen path
 *     (prevents path traversal and arbitrary keys). The client PUTs the file
 *     directly to that URL (enabling a progress bar) with no secret.
 *   • Views/downloads use short-lived SIGNED DOWNLOAD URLs minted here.
 *   • The bucket is private: no anonymous read or write is possible.
 * Authorization (whose bill, employee-vs-admin) is enforced in the server
 * actions that call these helpers.
 */

export const MAX_BILL_BYTES = 10 * 1024 * 1024; // 10 MB

// Allowed types — PDF + common images only. Executables/scripts/archives are
// rejected by both extension and MIME.
export const ALLOWED_BILL_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);

function cfg() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BILLS_BUCKET || "expense-bills";
  return { url, key, bucket };
}

export function isUploadConfigured(): boolean {
  const { url, key } = cfg();
  return !!url && !!key;
}

export interface BillMeta {
  filename: string;
  mimeType: string;
  size: number;
}

/** Validate an intended upload. Throws a user-facing message on any violation. */
export function validateBillMeta({ filename, mimeType, size }: BillMeta): string {
  if (!filename || filename.length > 200) throw new Error("Invalid file name.");
  if (!Number.isFinite(size) || size <= 0) throw new Error("The selected file is empty.");
  if (size > MAX_BILL_BYTES) {
    throw new Error(`File too large (max ${MAX_BILL_BYTES / (1024 * 1024)} MB).`);
  }
  if (!ALLOWED_BILL_MIME.includes(mimeType)) {
    throw new Error("Unsupported file type. Allowed: PDF, PNG, JPG, JPEG, WEBP.");
  }
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error("Unsupported file extension. Allowed: PDF, PNG, JPG, JPEG, WEBP.");
  }
  return EXT_BY_MIME[mimeType] ?? ext;
}

/**
 * Build a collision-free storage path from a server-trusted prefix (employee
 * code) + a random uuid. The prefix is sanitised to defeat traversal; the
 * extension is derived from the validated MIME, not the raw filename.
 */
export function buildBillPath(prefix: string, ext: string, now = new Date()): string {
  const safePrefix = (prefix || "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "UNKNOWN";
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${safePrefix}/${y}/${m}/${crypto.randomUUID()}.${ext}`;
}

async function storageFetch(path: string, init: RequestInit) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error("File uploads are not configured. Contact your administrator.");
  return fetch(`${url}/storage/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, apikey: key, ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

/** Create the private bucket if missing (idempotent). */
export async function ensureBucket(): Promise<void> {
  const { bucket } = cfg();
  const res = await storageFetch(`/bucket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: MAX_BILL_BYTES,
      allowed_mime_types: ALLOWED_BILL_MIME,
    }),
  });
  if (!res.ok && res.status !== 400 && res.status !== 409) {
    throw new Error(`Storage bucket unavailable (${res.status}).`);
  }
}

/** Mint a one-time signed upload URL for a specific path. */
export async function createSignedUploadUrl(path: string): Promise<{ path: string; uploadUrl: string }> {
  const { url, bucket } = cfg();
  await ensureBucket();
  const res = await storageFetch(`/object/upload/sign/${bucket}/${path}`, { method: "POST" });
  if (!res.ok) throw new Error("Could not start the upload. Please try again.");
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("Could not start the upload. Please try again.");
  // data.url is a relative "/object/upload/sign/<bucket>/<path>?token=..."
  return { path, uploadUrl: `${url}/storage/v1${data.url}` };
}

/** Mint a short-lived signed download/view URL. */
export async function createSignedDownloadUrl(path: string, expiresIn = 3600): Promise<string> {
  const { url, bucket } = cfg();
  const res = await storageFetch(`/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error("Could not open the bill. Please try again.");
  const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const signed = data.signedURL ?? data.signedUrl;
  if (!signed) throw new Error("Could not open the bill. Please try again.");
  return `${url}/storage/v1${signed}`;
}

/** Delete a stored object. Best-effort — a missing object is not an error. */
export async function deleteObject(path: string): Promise<void> {
  const { bucket } = cfg();
  try {
    const res = await storageFetch(`/object/${bucket}/${path}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      // Log-and-continue: never block an expense delete on a storage hiccup.
      console.warn(`[storage] delete ${path} -> ${res.status}`);
    }
  } catch (e) {
    console.warn(`[storage] delete ${path} failed`, e);
  }
}
