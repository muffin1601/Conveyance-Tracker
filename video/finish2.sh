#!/usr/bin/env bash
cd "$(dirname "$0")/.."
AUDIO="video/ElevenLabs_2026-08-01T10_33_04_Anvi - Warm, Emotional Girlfriend_pvc_sp88_s59_sb26_se0_b_m2.mp3"
SILENT="video/out/tutorial_without_audio.mp4"
FINAL="video/out/tutorial.mp4"

until grep -q "✔" video/build/par.log 2>/dev/null || grep -qi "^Error" video/build/par.log 2>/dev/null; do sleep 4; done
grep -q "✔" video/build/par.log 2>/dev/null || { echo "RENDER FAILED"; tail -4 video/build/par.log; exit 1; }

ffmpeg -y -hide_banner -loglevel error -i "$SILENT" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart -shortest "$FINAL" || { echo "MUX FAILED"; exit 1; }

npx tsx video/deliverables.ts

fail=0
for f in "$FINAL" "$SILENT"; do
  echo "== $f"
  err=$(ffmpeg -v error -xerror -i "$f" -f null - 2>&1 | head -3)
  [ -n "$err" ] && { echo "  DECODE ERRORS: $err"; fail=1; } || echo "  decode: clean"
  pf=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=nw=1:nk=1 "$f" | tr -d '\r,' | head -1)
  [ "$pf" = "yuv420p" ] && echo "  pix_fmt: $pf" || { echo "  BAD pix_fmt: $pf"; fail=1; }
  echo "  frames: $(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of default=nw=1:nk=1 "$f" | tr -d '\r,' | head -1)"
  echo "  duration: $(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f" | tr -d '\r,' | head -1)s"
  echo "  size: $(stat -c%s "$f")"
done
npx prisma generate >/dev/null 2>&1 && echo "prisma client restored to Postgres"
[ "$fail" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "VERIFICATION FAILED"
