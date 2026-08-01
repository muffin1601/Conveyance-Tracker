# Tutorial video pipeline

Produces `out/tutorial.mp4` — a 1080×1920, 60 fps Hindi walkthrough of the
Conveyance Tracker, cut to the ElevenLabs voiceover in the project root.

## Safety

Recording NEVER touches the production database. `seed-demo.ts` refuses to run
unless `DATABASE_URL` is a local `file:` SQLite URL, and the app is started
against `video/build/demo.db` on port 3100.

`prisma generate --schema video/schema.sqlite.prisma` swaps the generated
Prisma client to SQLite for the duration of recording. **Run
`npx prisma generate` afterwards** to put the Postgres client back — the last
step of `npm run video:all` does this for you.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| 1. Pause map | `ffmpeg silencedetect` | `build/gaps.json` |
| 2. Align script to audio | `npx tsx video/align.ts` | `build/alignment.json` |
| 3. Capture the real app | `npx tsx video/capture.ts` | `build/shots/*.png`, `build/shots.json` |
| 4. Direct the scenes | `npx tsx video/timeline.ts` | `build/timeline.json` |
| 5. Render frames → video | `npx tsx video/render.ts --no-audio` | `out/tutorial_without_audio.mp4` |
| 6. Mux the voiceover | `ffmpeg -c:v copy` | `out/tutorial.mp4` |
| 7. Captions & chapters | `npx tsx video/deliverables.ts` | `out/captions.srt`, `.vtt`, `timestamps.md` |

`npx tsx video/preview.ts 66 145 226` renders single frames at those seconds
into `build/preview/` for eyeballing without a full encode.

## Editing the video

The narration is fixed, so timing comes from `build/alignment.json`. To change
what is on screen at a given moment, edit the matching director in
`timeline.ts` (one function per script section) and re-run steps 4–6. Each
director receives its section's real sentence timings, so beats are expressed
as "when sentence 3 starts", never as hard-coded seconds.
