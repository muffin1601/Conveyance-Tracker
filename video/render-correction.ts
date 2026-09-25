import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd(), video = join(root, "video"), out = join(video, "out");
const audio = join(root, "public", "ElevenLabs_2026-09-23T12_17_45_Anika - Clear, Warm and Professional_pvc_sp110_s33_sb60_se0_b_m2.mp3");
const ffmpeg = join(video, "tools", "ffmpeg", "ffmpeg-master-latest-win64-gpl", "bin", "ffmpeg.exe");
const duration = 30.223625, fps = 30, frames = Math.ceil(duration * fps);

async function main() {
  mkdirSync(out, { recursive: true });
  const server = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(readFileSync(join(video, "correction-tutorial.html"))); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}`); await page.waitForFunction(() => (window as any).__ready);
  const ff = spawn(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-vcodec", "png", "-r", String(fps), "-i", "-", "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-shortest", join(out, "correct-distance-tutorial.mp4")], { stdio: ["pipe", "inherit", "inherit"] });
  for (let i=0;i<frames;i++) { await page.evaluate(ms => (window as any).__seek(ms), i/fps*1000); if (!ff.stdin.write(await page.screenshot({ type: "png" }))) await new Promise<void>(r => ff.stdin.once("drain", r)); if (i % 150 === 0) console.log(`${Math.round(i/frames*100)}%`); }
  ff.stdin.end(); await new Promise<void>((resolve,reject) => ff.on("close", c => c===0?resolve():reject(new Error(`ffmpeg exited ${c}`)))); await browser.close(); server.close(); console.log("✔ video/out/correct-distance-tutorial.mp4");
}
main().catch(e=>{console.error(e);process.exit(1)});
