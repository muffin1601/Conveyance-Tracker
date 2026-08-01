/**
 * Phase B — render the timeline to frames and encode the final video.
 *
 * The compositor page is driven by a virtual clock: for frame N we call
 * __seek(N/fps*1000) and screenshot. Nothing depends on wall-clock time, so
 * there are no dropped frames, no jitter, and the result is identical on every
 * run. Frames are piped straight into ffmpeg — never written to disk.
 *
 *   npx tsx video/render.ts              # full render
 *   npx tsx video/render.ts --from 0 --to 20 --out sample.mp4
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(process.cwd(), "video");
const BUILD = join(ROOT, "build");
const OUT = join(ROOT, "out");

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k: string) => argv.includes(`--${k}`);

const AUDIO = join(
  process.cwd(),
  "ElevenLabs_2026-08-01T08_29_35_Anvi - Warm, Emotional Girlfriend_pvc_sp83_s59_sb26_se0_b_m2.mp3",
);

const timeline = JSON.parse(readFileSync(join(BUILD, "timeline.json"), "utf8"));
const shotIndex: Record<string, unknown> = Object.fromEntries(
  JSON.parse(readFileSync(join(BUILD, "shots.json"), "utf8")).shots.map((s: { name: string }) => [s.name, s]),
);

const FPS = timeline.fps ?? 60;
const W = timeline.width ?? 1080;
const H = timeline.height ?? 1920;
const FROM_MS = Math.round(Number(arg("from", "0")) * 1000);
const TO_MS = Math.round(Number(arg("to", String(timeline.durationMs / 1000))) * 1000);
const OUT_NAME = arg("out", flag("no-audio") ? "tutorial_without_audio.mp4" : "tutorial.mp4")!;
const WITH_AUDIO = !flag("no-audio");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
};

/**
 * Serve video/ over HTTP. file:// would work for the page itself but Chromium
 * treats each local image as a separate origin and decodes them far slower.
 */
function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "") || "compositor.html";
    const file = join(ROOT, rel);
    if (rel === "favicon.ico") { res.writeHead(204).end(); return; }
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}/compositor.html`, close: () => server.close() });
    });
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (WITH_AUDIO && !existsSync(AUDIO)) throw new Error(`Voiceover not found: ${AUDIO}`);

  const totalFrames = Math.round(((TO_MS - FROM_MS) / 1000) * FPS);
  const outPath = OUT_NAME.startsWith("..") ? join(OUT, OUT_NAME) : join(OUT, OUT_NAME);
  console.log(`Rendering ${totalFrames} frames  (${(FROM_MS / 1000).toFixed(1)}s → ${(TO_MS / 1000).toFixed(1)}s ` +
              `@ ${FPS}fps, ${W}×${H})\n  → ${outPath}`);

  const { url, close } = await serve();

  const browser = await chromium.launch({
    args: [
      "--force-color-profile=srgb",
      "--disable-lcd-text",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--disable-frame-rate-limit",
      "--disable-gpu-vsync",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  page.on("console", (m) => { if (m.type() === "error") console.warn("  compositor:", m.text()); });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await page.evaluate(([tl, si]) => (window as never as { __load: (a: unknown, b: unknown) => void }).__load(tl, si),
    [timeline, shotIndex] as const);
  const n = await page.evaluate(() => (window as never as { __preload: () => Promise<number> }).__preload());
  console.log(`  ${n} captures preloaded & decoded`);

  // ── ffmpeg ────────────────────────────────────────────────────────
  const args = [
    "-y", "-hide_banner", "-loglevel", "error", "-stats",
    "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(FPS), "-i", "pipe:0",
  ];
  if (WITH_AUDIO) {
    args.push("-ss", String(FROM_MS / 1000), "-i", AUDIO);
  }
  args.push(
    "-map", "0:v:0",
    // The MJPEG pipe carries full-range (yuvj420p) colour. Without an explicit
    // range conversion that tag survives into the MP4, and yuvj420p is
    // deprecated — Windows Media Player, WhatsApp and several Android players
    // reject such a file as "corrupt or not supported". Convert to limited
    // range and pin the format so the output is broadly playable.
    "-vf", "scale=in_range=full:out_range=limited,format=yuv420p",
    "-color_range", "tv",
    ...(WITH_AUDIO ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest"] : []),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level", "4.0",
    "-r", String(FPS),
    "-movflags", "+faststart",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    // Segment mode: a fixed, closed GOP with no scene-cut keyframes means each
    // segment begins on an IDR, which is what makes concatenating them by
    // stream copy legal and seamless.
    ...(flag("segment") ? ["-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-force_key_frames", "expr:eq(n,0)"] : []),
    outPath,
  );

  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => {
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
    ff.on("error", rej);
  });

  const write = (buf: Buffer) =>
    new Promise<void>((res, rej) => {
      // Respect backpressure: encoding is slower than screenshotting.
      if (ff.stdin.write(buf)) res();
      else ff.stdin.once("drain", () => res());
      ff.stdin.once("error", rej);
    });

  const t0 = Date.now();
  for (let f = 0; f < totalFrames; f++) {
    const tMs = FROM_MS + (f / FPS) * 1000;
    await page.evaluate((t) => (window as never as { __seek: (n: number) => void }).__seek(t), tMs);
    // JPEG at q94 is visually lossless against a CRF-18 x264 target and
    // encodes roughly 3x faster in Chromium than PNG, which is the single
    // biggest lever on total render time.
    const buf = await page.screenshot({ type: "jpeg", quality: 94, animations: "disabled", caret: "hide" });
    await write(buf);

    if (f % 120 === 0 || f === totalFrames - 1) {
      const pct = ((f + 1) / totalFrames) * 100;
      const rate = (f + 1) / ((Date.now() - t0) / 1000);
      const eta = (totalFrames - f - 1) / Math.max(rate, 0.001);
      process.stdout.write(
        `\r  frame ${f + 1}/${totalFrames}  ${pct.toFixed(1)}%  ` +
        `${rate.toFixed(1)} fps  eta ${Math.round(eta)}s     `,
      );
    }
  }
  process.stdout.write("\n");

  ff.stdin.end();
  await done;
  await browser.close();
  close();

  console.log(`\n✔ ${outPath}`);
  void pathToFileURL;
}

main().catch((e) => { console.error(e); process.exit(1); });
