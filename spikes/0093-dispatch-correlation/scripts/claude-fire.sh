#!/usr/bin/env bash
# THROWAWAY spike script (task 0093). Fires an imported Claude routine headlessly
# and records the non-agent-dependent correlation signal (session id/url).
#
# Required env:
#   LOOPER_SPIKE_CLAUDE_FIRE_URL    per-routine /fire URL (imported from Claude web UI)
#   LOOPER_SPIKE_CLAUDE_FIRE_TOKEN  per-routine bearer token (imported from Claude web UI)
# Optional env:
#   SPIKE_ISSUE   issue number the brief references (default 1)
#   SPIKE_RUN_ID  correlation run id (default: GITHUB_RUN_ID or epoch seconds)
#   SPIKE_OUT     output dir for run logs (default ./spike-runs)
#
# Usage: ./claude-fire.sh
set -euo pipefail

: "${LOOPER_SPIKE_CLAUDE_FIRE_URL:?missing fire URL (import from Claude web UI; see RUNBOOK §1)}"
: "${LOOPER_SPIKE_CLAUDE_FIRE_TOKEN:?missing fire token (import from Claude web UI; see RUNBOOK §1)}"

ISSUE="${SPIKE_ISSUE:-1}"
RUN_ID="${SPIKE_RUN_ID:-${GITHUB_RUN_ID:-$(date +%s)}}"
OUT_DIR="${SPIKE_OUT:-./spike-runs}"
mkdir -p "$OUT_DIR"

BRANCH="looper/spike/${ISSUE}-${RUN_ID}"

# The brief embeds both agent-obeyed correlation signals under test.
read -r -d '' PROMPT <<EOF || true
Spike trial ${RUN_ID}. In the connected repository: create a file
spike-output/trial-${RUN_ID}.txt containing the single line "spike ${RUN_ID}",
on a NEW branch named exactly "${BRANCH}", and open a pull request titled
"spike: trial ${RUN_ID}" whose body ends with the exact trailer line:

looper-run: ${RUN_ID}

Do nothing else. Do not modify any other file.
EOF

echo "firing routine for run ${RUN_ID} (issue ${ISSUE})..."
HTTP_CODE=$(curl -sS -o "$OUT_DIR/fire-${RUN_ID}.json" -w '%{http_code}' \
  -X POST "$LOOPER_SPIKE_CLAUDE_FIRE_URL" \
  -H "Authorization: Bearer $LOOPER_SPIKE_CLAUDE_FIRE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg p "$PROMPT" '{prompt: $p}')")

echo "http_code=${HTTP_CODE}"
cat "$OUT_DIR/fire-${RUN_ID}.json" || true

# Record the dispatch-time (non-agent-dependent) correlation signal.
jq -n \
  --arg run_id "$RUN_ID" \
  --arg issue "$ISSUE" \
  --arg branch "$BRANCH" \
  --arg http_code "$HTTP_CODE" \
  --slurpfile resp "$OUT_DIR/fire-${RUN_ID}.json" \
  '{provider: "claude", run_id: $run_id, issue: $issue,
    expected_branch: $branch, expected_trailer: ("looper-run: " + $run_id),
    fired_at: (now | todate), http_code: $http_code, fire_response: $resp[0]}' \
  > "$OUT_DIR/dispatch-${RUN_ID}.json"

echo "dispatch record: $OUT_DIR/dispatch-${RUN_ID}.json"
[ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]
