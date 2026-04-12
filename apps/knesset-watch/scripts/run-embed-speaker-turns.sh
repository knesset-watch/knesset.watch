#!/bin/bash
# Runs embed-speaker-turns.ts in a tight loop — one batch per invocation.
# Usage: bash run-embed-speaker-turns.sh [--asc|--desc]
# Two workers can run in parallel: one --asc (bottom up), one --desc (top down)
# Exit 42 = shard complete; anything else = retry.
cd "$(dirname "$0")/.."

DIR=${1:---asc}
LOGFILE="embed-turns-${DIR//-/}.log"  # embed-turns-asc.log or embed-turns-desc.log

echo "[start ${DIR} @ $(date '+%H:%M:%S')]" >> "$LOGFILE"

while true; do
  node scripts/embed-speaker-turns.js "$DIR" >> "$LOGFILE" 2>&1
  EXIT=$?

  if [ $EXIT -eq 42 ]; then
    echo "[DONE ${DIR} @ $(date '+%H:%M:%S')]" >> "$LOGFILE"
    exit 0
  fi

  if [ $EXIT -ne 0 ]; then
    JITTER=$((5 + RANDOM % 15))
    echo "[error ${DIR} @ $(date '+%H:%M:%S')] Exit $EXIT, retrying in ${JITTER}s..." >> "$LOGFILE"
    sleep $JITTER
  else
    sleep 2
  fi
done
