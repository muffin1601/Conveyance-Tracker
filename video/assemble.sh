#!/usr/bin/env bash
# Final assembly: mux the untouched ElevenLabs voiceover onto the rendered
# picture, then verify both masters. The video stream is copied, never
# re-encoded, so tutorial.mp4 and tutorial_without_audio.mp4 are identical
# frame for frame.
set -euo pipefail

cd "$(dirname "$0")/.."

AUDIO="ElevenLabs_2026-08-01T08_29_35_Anvi - Warm, Emotional Girlfriend_pvc_sp83_s59_sb26_se0_b_m2.mp3"
SILENT="video/out/tutorial_without_audio.mp4"
FINAL="video/out/tutorial.mp4"

[ -f "$SILENT" ] || { echo "Render the picture first: npm run video:render"; exit 1; }
[ -f "$AUDIO" ]  || { echo "Voiceover not found: $AUDIO"; exit 1; }

echo "→ muxing voiceover"
ffmpeg -y -hide_banner -loglevel error \
  -i "$SILENT" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart \
  -shortest "$FINAL"

echo
for f in "$SILENT" "$FINAL"; do
  echo "== $f"
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames,pix_fmt \
    -show_entries format=duration,size -of default=nw=1 "$f"
  ffprobe -v error -select_streams a:0 \
    -show_entries stream=codec_name,sample_rate,channels -of default=nw=1 "$f" 2>/dev/null || echo "(no audio track)"
  echo
done
