#!/bin/bash
# SessionStart hook: install npm dependencies in Claude Code on the web sessions.
# Runs `npm ci` only when node_modules is missing or package-lock.json changed
# since the last successful install. Never blocks the session on failure.
set -uo pipefail

# Local developer environments: do nothing.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

STAMP="node_modules/.session-start-lock.sha256"
LOG_DIR="_tmp_ai"
LOG_FILE="$LOG_DIR/session-start-npm-ci.log"

if [ ! -f package-lock.json ]; then
  echo "[session-start] package-lock.json not found; skipped dependency install."
  exit 0
fi

LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"

if [ -d node_modules ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$LOCK_HASH" ]; then
  echo "[session-start] node_modules is up to date with package-lock.json; skipped npm ci."
  exit 0
fi

mkdir -p "$LOG_DIR"
if npm ci --no-audit --no-fund >"$LOG_FILE" 2>&1; then
  echo "$LOCK_HASH" >"$STAMP"
  echo "[session-start] npm ci completed (log: $LOG_FILE)."
else
  echo "[session-start] WARNING: npm ci failed (exit $?). Run 'npm ci' manually. Log: $LOG_FILE"
  tail -n 20 "$LOG_FILE"
fi

exit 0
