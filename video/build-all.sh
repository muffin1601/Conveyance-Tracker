#!/usr/bin/env bash
# Render the picture, mux the voiceover, then PROVE both files are playable.
# Nothing is reported as finished unless every frame decodes without error.
set -uo pipefail
cd "$(dirname "$0")/.."

AUDIO="ElevenLabs_2026-08-01T08_29_35_Anvi - Warm, Emotional Girlfriend_pvc_sp83_s59_sb26_se0_b_m2.mp3"
SILENT="video/out/tutorial_without_audio.mp4"
FINAL="video/out/tutorial.mp4"
LOG="video/build/build-all.log"

echo "[1/4] rendering picture …"
npx tsx video/render.ts --no-audio --out tutorial_without_audio.mp4 >"$LOG" 2>&1
if [ $? -ne 0 ] || [ ! -f "$SILENT" ]; then
  echo "RENDER FAILED — see $LOG"; tail -20 "$LOG"; exit 1
fi

echo "[2/4] muxing voiceover (video stream copied, not re-encoded) …"
ffmpeg -y -hide_banner -loglevel error \
  -i "$SILENT" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart -shortest "$FINAL" || { echo "MUX FAILED"; exit 1; }

echo "[3/4] verifying …"
fail=0
for f in "$SILENT" "$FINAL"; do
  echo "── $f"
  # Every frame must decode cleanly.
  err=$(ffmpeg -v error -xerror -i "$f" -f null - 2>&1 | head -5)
  if [ -n "$err" ]; then echo "  DECODE ERRORS:"; echo "$err"; fail=1; else echo "  decode: clean"; fi

  pf=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$f")
  [ "$pf" = "yuv420p" ] && echo "  pix_fmt: $pf" || { echo "  BAD pix_fmt: $pf"; fail=1; }

  n=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$f")
  echo "  frames: $n"

  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  echo "  duration: ${d}s   size: $(stat -c%s "$f") bytes"

  # moov must precede mdat so the file streams and opens instantly.
  if python -c "
import sys
d=open(r'$f','rb').read(2000000)
sys.exit(0 if 0 <= d.find(b'moov') < d.find(b'mdat') else 1)"; then
    echo "  faststart: yes"
  else
    echo "  faststart: NO"; fail=1
  fi
done

echo "[4/4] restoring the Postgres Prisma client …"
npx prisma generate >/dev/null 2>&1 && echo "  restored" || echo "  WARNING: run 'npx prisma generate' manually"

[ "$fail" -eq 0 ] && echo "ALL CHECKS PASSED" || { echo "VERIFICATION FAILED"; exit 1; }
