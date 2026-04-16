#!/bin/bash
# Waits for the plenary worker bash wrapper to finish, then
# starts a third committee (session_speaker_turn) worker.
# Usage: bash scripts/plenary-done-then-committee.sh <plenary_bash_pid>
# Example: bash scripts/plenary-done-then-committee.sh 52363

cd "$(dirname "$0")/.."

PLENARY_PID=${1:?Usage: $0 <plenary_bash_pid>}
LOGFILE="embed-turns-asc2.log"

echo "[watcher @ $(date '+%H:%M:%S')] Watching plenary PID $PLENARY_PID..." >> "$LOGFILE"

while kill -0 "$PLENARY_PID" 2>/dev/null; do
  sleep 30
done

echo "[watcher @ $(date '+%H:%M:%S')] Plenary done. Starting committee worker 3 (--asc)..." >> "$LOGFILE"

while true; do
  node scripts/embed-speaker-turns.js --asc >> "$LOGFILE" 2>&1
  EXIT=$?

  if [ $EXIT -eq 42 ]; then
    echo "[DONE --asc @ $(date '+%H:%M:%S')]" >> "$LOGFILE"
    exit 0
  fi

  if [ $EXIT -ne 0 ]; then
    JITTER=$((5 + RANDOM % 15))
    echo "[error @ $(date '+%H:%M:%S')] Exit $EXIT, retrying in ${JITTER}s..." >> "$LOGFILE"
    sleep $JITTER
  else
    sleep 2
  fi
done
