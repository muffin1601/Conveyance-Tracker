/**
 * Parallel renderer — the fast path.
 *
 * The bottleneck is not encoding, it is the per-frame Playwright screenshot
 * (~120 ms). One browser therefore tops out around 8 fps regardless of the
 * x264 preset. This splits the timeline into N contiguous segments, renders
 * them in separate browsers at the same time, then concatenates the segments
 * with a stream copy (no re-encode, no generation loss).
 *
 * Each segment is encoded with a fixed, closed GOP so every segment starts on
 * an IDR frame — that is what makes a bit-exact concat legal.
 *
 *   npx tsx video/render-parallel.ts --workers 6
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "video");
const BUILD = join(ROOT, "build");
const OUT = join(ROOT, "out");
const SEG = join(BUILD, "segments");

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};

const timeline = JSON.parse(readFileSync(join(BUILD, "timeline.json"), "utf8"));
const FPS: number = timeline.fps ?? 60;
const DURATION_MS: number = timeline.durationMs;
const WORKERS = Math.max(1, Number(arg("workers", "6")));
const OUT_NAME = arg("out", "tutorial_without_audio.mp4");

/**
 * Split on exact frame boundaries so no frame is rendered twice or dropped.
 * The last segment absorbs the remainder.
 */
function plan() {
  const total = Math.round((DURATION_MS / 1000) * FPS);
  const per = Math.ceil(total / WORKERS);
  const segs: { i: number; startFrame: number; frames: number }[] = [];
  for (let i = 0, f = 0; f < total; i++, f += per) {
    segs.push({ i, startFrame: f, frames: Math.min(per, total - f) });
  }
  return { total, segs };
}

function run(cmd: string, args: string[], label: string): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let last = "";
    p.stdout.on("data", (d) => { last = String(d).trim().split("\n").pop() ?? last; });
    p.stderr.on("data", (d) => { last = String(d).trim().split("\n").pop() ?? last; });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${label} exited ${c}: ${last.slice(-300)}`))));
    p.on("error", rej);
  });
}

async function main() {
  rmSync(SEG, { recursive: true, force: true });
  mkdirSync(SEG, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const { total, segs } = plan();
  console.log(`${total} frames @ ${FPS}fps → ${segs.length} segments across ${WORKERS} workers`);

  const t0 = Date.now();
  let done = 0;
  await Promise.all(
    segs.map(async (s) => {
      const from = s.startFrame / FPS;
      const to = (s.startFrame + s.frames) / FPS;
      await run("npx", [
        "tsx", "video/render.ts",
        "--no-audio",
        "--from", String(from),
        "--to", String(to),
        "--out", `../build/segments/seg-${String(s.i).padStart(2, "0")}.mp4`,
        "--segment",
      ], `segment ${s.i}`);
      done++;
      const pct = (done / segs.length) * 100;
      const el = (Date.now() - t0) / 1000;
      console.log(`  segment ${s.i} done — ${done}/${segs.length} (${pct.toFixed(0)}%), ${el.toFixed(0)}s elapsed`);
    }),
  );

  // ── Concat (stream copy) ──────────────────────────────────────────
  const list = join(SEG, "list.txt");
  writeFileSync(
    list,
    segs.map((s) => `file '${join(SEG, `seg-${String(s.i).padStart(2, "0")}.mp4`).replace(/\\/g, "/")}'`).join("\n"),
  );
  for (const s of segs) {
    const f = join(SEG, `seg-${String(s.i).padStart(2, "0")}.mp4`);
    if (!existsSync(f)) throw new Error(`missing segment: ${f}`);
  }

  console.log("concatenating (stream copy) …");
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", list,
    "-c", "copy", "-movflags", "+faststart",
    join(OUT, OUT_NAME),
  ], "concat");

  console.log(`\n✔ ${join(OUT, OUT_NAME)}  (${((Date.now() - t0) / 1000 / 60).toFixed(1)} min)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
