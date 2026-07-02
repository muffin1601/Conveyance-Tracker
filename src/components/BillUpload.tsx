"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, FileText, X, Loader2, RotateCw, Image as ImageIcon } from "lucide-react";
import { requestBillUpload, discardBill } from "@/app/actions/bills";
import { cn } from "@/lib/utils";

export interface BillMetaValue {
  path: string;
  name: string;
  type: string;
  size: number;
}

const MAX_MB = 10;
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reusable bill uploader. Uploads directly to a server-issued signed URL with
 * a real progress bar, then reports the stored path + metadata via onChange.
 * The parent persists that metadata when it saves the expense. No secrets and
 * no service-role key ever reach the browser.
 */
export function BillUpload({
  employeeId,
  onChange,
  disabled,
}: {
  employeeId: string;
  onChange: (meta: BillMetaValue | null) => void;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const uploadedPathRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Revoke object URLs to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      xhrRef.current?.abort();
    };
  }, [previewUrl]);

  function validate(f: File): string | null {
    if (f.size <= 0) return "The selected file is empty.";
    if (f.size > MAX_MB * 1024 * 1024) return `File too large (max ${MAX_MB} MB).`;
    if (!ALLOWED.includes(f.type)) return "Unsupported type. Allowed: PDF, PNG, JPG, JPEG, WEBP.";
    return null;
  }

  const doUpload = useCallback(async (f: File) => {
    setStatus("uploading");
    setProgress(0);
    setError("");
    try {
      const ticket = await requestBillUpload({
        employeeId,
        filename: f.name,
        mimeType: f.type,
        size: f.size,
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("PUT", ticket.uploadUrl);
        xhr.setRequestHeader("Content-Type", f.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.ontimeout = () => reject(new Error("Upload timed out."));
        xhr.timeout = 60000;
        xhr.send(f);
      });
      uploadedPathRef.current = ticket.path;
      setStatus("done");
      setProgress(100);
      onChange({ path: ticket.path, name: f.name, type: f.type, size: f.size });
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }, [employeeId, onChange]);

  async function pick(f: File) {
    const v = validate(f);
    if (v) { setError(v); setStatus("error"); return; }
    // Replacing an earlier not-yet-saved upload → clean it up first.
    if (uploadedPathRef.current) {
      const old = uploadedPathRef.current;
      uploadedPathRef.current = null;
      discardBill(employeeId, old).catch(() => {});
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    await doUpload(f);
  }

  function remove() {
    xhrRef.current?.abort();
    const old = uploadedPathRef.current;
    uploadedPathRef.current = null;
    if (old) discardBill(employeeId, old).catch(() => {});
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setProgress(0);
    setStatus("idle");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
    onChange(null);
  }

  if (file) {
    return (
      <div className="rounded-lg border p-3">
        <div className="flex items-start gap-3">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="bill preview" className="h-14 w-14 rounded object-cover border" loading="lazy" />
          ) : (
            <div className="h-14 w-14 rounded border flex items-center justify-center bg-bg">
              <FileText className="h-6 w-6 text-muted" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs text-muted">{humanSize(file.size)}</p>
            {status === "uploading" && (
              <div className="mt-1.5">
                <div className="h-1.5 w-full rounded bg-bg overflow-hidden">
                  <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Uploading… {progress}%</p>
              </div>
            )}
            {status === "done" && <p className="mt-1 text-xs text-green-600">Uploaded ✓</p>}
            {status === "error" && (
              <div className="mt-1 flex items-center gap-2">
                <p className="text-xs text-red-600">{error}</p>
                <button type="button" onClick={() => doUpload(file)} className="text-xs text-brand inline-flex items-center gap-0.5"><RotateCw className="h-3 w-3" /> Retry</button>
              </div>
            )}
          </div>
          <button type="button" onClick={remove} disabled={disabled} className="text-muted hover:text-red-600" aria-label="Remove attachment">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) pick(f);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center cursor-pointer transition",
          dragOver ? "border-brand bg-brand/5" : "hover:bg-bg",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        <UploadCloud className="h-6 w-6 text-muted" />
        <p className="text-sm"><span className="text-brand font-medium">Browse</span> or drag &amp; drop a bill</p>
        <p className="text-xs text-muted flex items-center gap-1"><ImageIcon className="h-3 w-3" /> PDF, PNG, JPG, JPEG, WEBP · max {MAX_MB} MB</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }}
      />
      {status === "error" && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
