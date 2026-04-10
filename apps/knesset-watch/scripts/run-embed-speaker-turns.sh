#!/bin/bash
# Auto-restarts embed-speaker-turns.ts until completion.
# Safe: the script skips already-embedded rows on each run.
cd "$(dirname "$0")/.."

LOGFILE="embed-turns.log"
MAX_RESTARTS=500
restart=0

while [ $restart -lt $MAX_RESTARTS ]; do
  echo "[restart #$restart @ $(date '+%H:%M:%S')] Starting embed-speaker-turns..." >> "$LOGFILE"
  npx tsx scripts/embed-speaker-turns.ts >> "$LOGFILE" 2>&1
  EXIT=$?
  if [ $EXIT -eq 0 ]; then
    echo "[DONE @ $(date '+%H:%M:%S')] Embedding complete." >> "$LOGFILE"
    exit 0
  fi
  restart=$((restart + 1))
  echo "[restart #$restart] Exit code $EXIT, sleeping 10s..." >> "$LOGFILE"
  sleep 10
done

echo "Max restarts reached." >> "$LOGFILE"
