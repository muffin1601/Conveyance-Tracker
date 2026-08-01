/**
 * Emit the non-video deliverables: captions.srt, captions.vtt and
 * timestamps.md, all derived from the same alignment the video was cut to —
 * so the subtitles and the chapter list can never drift from the picture.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BUILD = join(process.cwd(), "video", "build");
const OUT = join(process.cwd(), "video", "out");

interface Sentence { text: string; start: number; end: number }
interface Section { id: string; chapter: string; kicker: string; start: number; end: number; sentences: Sentence[] }

const { audioSec, sections } = JSON.parse(readFileSync(join(BUILD, "alignment.json"), "utf8")) as
  { audioSec: number; sections: Section[] };
const timeline = JSON.parse(readFileSync(join(BUILD, "timeline.json"), "utf8"));

/** SRT wants HH:MM:SS,mmm — VTT wants a dot. */
function stamp(sec: number, sep = ","): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` +
         `${sep}${String(f).padStart(3, "0")}`;
}

const mmss = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * Devanagari has no inter-word breaks issue, but a 40-character line is the
 * comfortable limit on a 1080-wide phone. Wrap long cues onto two lines.
 */
function wrap(text: string, max = 42): string {
  if (text.length <= max) return text;
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max && line) { lines.push(line.trim()); line = w; }
    else line = `${line} ${w}`;
  }
  if (line.trim()) lines.push(line.trim());
  // Never more than two lines on screen; merge the tail if it overflows.
  if (lines.length > 2) {
    const half = Math.ceil(lines.length / 2);
    return [lines.slice(0, half).join(" "), lines.slice(half).join(" ")].join("\n");
  }
  return lines.join("\n");
}

const cues = sections.flatMap((s) => s.sentences.map((c) => ({ ...c, section: s.id })));

function srt(): string {
  return cues.map((c, i) =>
    `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${wrap(c.text)}\n`).join("\n");
}

function vtt(): string {
  return "WEBVTT\n\n" + cues.map((c, i) =>
    `${i + 1}\n${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${wrap(c.text)}\n`).join("\n");
}

function timestamps(): string {
  const totalCues = cues.length;
  const scenes: { id: string; start: number; end: number; effects?: unknown[]; frames?: unknown[] }[] = timeline.scenes;

  const lines: string[] = [];
  lines.push("# Conveyance Tracker — tutorial timeline\n");
  lines.push(`**Duration** ${mmss(audioSec)} (${audioSec.toFixed(2)} s) · ` +
             `**${timeline.width}×${timeline.height}** · **${timeline.fps} fps** · H.264 High\n`);
  lines.push(`Narration: Hindi, ${sections.length} sections, ${totalCues} subtitle cues.\n`);

  lines.push("## Chapters\n");
  lines.push("| Time | Section | On screen |");
  lines.push("| --- | --- | --- |");
  const onScreen: Record<string, string> = {
    intro: "Title card, then the Check In page",
    open: "Check In page; the three tabs highlighted in turn",
    name: "Your Name picker — opened, searched, employee selected",
    location: "Where Are You Going picker; Trip 1 starting at Head Office",
    gps: "Use Current GPS → detected address panel",
    transport: "Bike / Car / Bus-Metro cards, each highlighted with its rate",
    log: "Log This Visit tapped; confirmation and Trip 2 state",
    chain: "Trip 2 and Trip 3 auto-starting from the previous stop; trip timeline",
    reset: "Reset Journey tapped; starting point returns to Head Office",
    summary: "Scroll through Today's Summary to Total Conveyance and Grand Total",
    bill: "Add bill control on a logged trip",
    misc: "Miscellaneous Expenses card, employee picker, expense form",
    ending: "Recap callouts, closing card",
  };
  for (const s of sections) {
    lines.push(`| \`${mmss(s.start)}\` | **${s.chapter}** | ${onScreen[s.id] ?? "—"} |`);
  }

  lines.push("\n## Scene-by-scene\n");
  lines.push("| Start | End | Scene | Captures | Annotations |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const sc of scenes) {
    lines.push(`| \`${mmss(sc.start / 1000)}\` | \`${mmss(sc.end / 1000)}\` | ${sc.id} | ` +
               `${(sc.frames ?? []).length || 1} | ${(sc.effects ?? []).length} |`);
  }

  lines.push("\n## Narration ↔ screen\n");
  lines.push("Every cue below is anchored to a real pause in the voiceover; the action for");
  lines.push("that cue is timed to start after the narrator begins the sentence.\n");
  for (const s of sections) {
    lines.push(`\n### ${mmss(s.start)} — ${s.chapter}\n`);
    for (const c of s.sentences) {
      lines.push(`- \`${mmss(c.start)}\` ${c.text}`);
    }
  }
  return lines.join("\n") + "\n";
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "captions.srt"), srt(), "utf8");
writeFileSync(join(OUT, "captions.vtt"), vtt(), "utf8");
writeFileSync(join(OUT, "timestamps.md"), timestamps(), "utf8");
console.log(`✔ captions.srt  (${cues.length} cues)`);
console.log(`✔ captions.vtt`);
console.log(`✔ timestamps.md`);
