/**
 * Render single frames at chosen timestamps for eyeballing, without encoding.
 *   npx tsx video/preview.ts 57 100 150 200
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = join(process.cwd(), "video");
const BUILD = join(ROOT, "build");
const OUT = join(BUILD, "preview");

const times = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
if (!times.length) { console.error("usage: preview.ts <seconds...>"); process.exit(1); }

const timeline = JSON.parse(readFileSync(join(BUILD, "timeline.json"), "utf8"));
const shotIndex = Object.fromEntries(
  JSON.parse(readFileSync(join(BUILD, "shots.json"), "utf8")).shots.map((s: { name: string }) => [s.name, s]),
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json",
};

function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "") || "compositor.html";
    if (rel === "favicon.ico") { res.writeHead(204).end(); return; }
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    r({ url: `http://127.0.0.1:${port}/compositor.html`, close: () => server.close() });
  }));
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const { url, close } = await serve();
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await page.evaluate(([tl, si]) => (window as never as { __load: (a: unknown, b: unknown) => void }).__load(tl, si),
    [timeline, shotIndex] as const);
  await page.evaluate(() => (window as never as { __preload: () => Promise<number> }).__preload());

  for (const t of times) {
    await page.evaluate((ms) => (window as never as { __seek: (n: number) => void }).__seek(ms), t * 1000);
    const f = join(OUT, `t${String(t).replace(".", "_")}.png`);
    await page.screenshot({ path: f });
    console.log("  ·", f);
  }
  await browser.close();
  close();
})();
