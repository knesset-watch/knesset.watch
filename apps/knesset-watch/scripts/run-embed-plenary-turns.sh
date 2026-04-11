#!/bin/bash
# Runs embed-plenary-turns.js in a tight loop — one batch per invocation.
cd "$(dirname "$0")/.."

DIR=${1:---asc}
LOGFILE="embed-plenary-${DIR//-/}.log"

echo "[start ${DIR} @ $(date '+%H:%M:%S')]" >> "$LOGFILE"

while true; do
  node scripts/embed-plenary-turns.js "$DIR" >> "$LOGFILE" 2>&1
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
