/** Create the pause map consumed by align.ts from the tutorial narration. */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const audio = join(root, "video", "ElevenLabs_2026-08-01T10_33_04_Anvi - Warm, Emotional Girlfriend_pvc_sp88_s59_sb26_se0_b_m2.mp3");
const ffmpeg = join(root, "video", "tools", "ffmpeg", "ffmpeg-master-latest-win64-gpl", "bin", "ffmpeg.exe");
const result = spawnSync(ffmpeg, ["-hide_banner", "-i", audio, "-af", "silencedetect=noise=-35dB:d=0.12", "-f", "null", "-"], { encoding: "utf8" });
const text = `${result.stdout}\n${result.stderr}`;
const gaps: { start: number; end: number; dur: number }[] = [];
let start: number | undefined;
for (const line of text.split(/\r?\n/)) {
  const s = line.match(/silence_start:\s*([\d.]+)/);
  if (s) { start = Number(s[1]); continue; }
  const e = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
  if (e && start !== undefined) {
    gaps.push({ start, end: Number(e[1]), dur: Number(e[2]) });
    start = undefined;
  }
}
if (result.status !== 0 || gaps.length === 0) throw new Error("Could not detect narration pauses");
const build = join(root, "video", "build");
mkdirSync(build, { recursive: true });
writeFileSync(join(build, "gaps.json"), JSON.stringify(gaps, null, 2));
console.log(`Wrote ${gaps.length} narration pauses.`);
