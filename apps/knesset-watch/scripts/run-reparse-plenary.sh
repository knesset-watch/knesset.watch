#!/bin/bash
# Runs reparse-plenary.js one session at a time.
# Exit 42 = all sessions done; anything else = retry (including timeout from connection saturation).
cd "$(dirname "$0")/.."

LOGFILE="reparse-plenary.log"
echo "[start @ $(date '+%H:%M:%S')]" >> "$LOGFILE"

while true; do
  node scripts/reparse-plenary.js >> "$LOGFILE" 2>&1
  EXIT=$?

  if [ $EXIT -eq 42 ]; then
    echo "[DONE @ $(date '+%H:%M:%S')] All plenary sessions reparsed." >> "$LOGFILE"
    exit 0
  fi

  if [ $EXIT -ne 0 ]; then
    echo "[error @ $(date '+%H:%M:%S')] Exit $EXIT, retrying in 5s..." >> "$LOGFILE"
    sleep 5
  else
    sleep 1
  fi
done
