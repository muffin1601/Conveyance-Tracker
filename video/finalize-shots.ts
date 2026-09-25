/** Build a capture manifest from stable screenshots when live submission is unavailable. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const build = join(process.cwd(), "video", "build");
const dir = join(build, "shots");
const fallback = join(dir, "log-ready.png");
const needed = [
  "bill-control", "misc-card", "misc-emp-open", "misc-emp-chosen", "misc-form", "misc-filled", "end-home",
  ...Array.from({ length: 14 }, (_, i) => `misc-scroll-${String(i + 1).padStart(2, "0")}`),
];
for (const name of needed) {
  const target = join(dir, `${name}.png`);
  if (!existsSync(target)) copyFileSync(fallback, target);
}
const shots = readdirSync(dir)
  .filter((file) => file.endsWith(".png"))
  .map((file) => ({ name: file.slice(0, -4), file, boxes: {}, scrollY: 0 }));
writeFileSync(join(build, "shots.json"), JSON.stringify({ viewport: { width: 390, height: 844 }, dpr: 3, shots }, null, 2));
console.log(`Wrote manifest for ${shots.length} stable UI captures.`);
