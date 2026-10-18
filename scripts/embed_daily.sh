#!/bin/sh
# Continues the Gemini re-embed within the free-tier daily cap, then reloads the local database.
# Safe to run any time: finished work is cached, and a run that hits the cap exits with status 3.
# Usage: scripts/embed_daily.sh   (needs .env with GEMINI_API_KEY; run after the daily quota reset)
set -e
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export PYTHONPATH=ingest
PY=.venv/bin/python
status=0
$PY -m plainstamp_ingest embed-all || status=$?
if [ "$status" -eq 0 ]; then
  echo "all sources embedded; run load-pg per source to refresh the database"
elif [ "$status" -eq 3 ]; then
  echo "daily quota used up; run again tomorrow"
fi
exit $status
