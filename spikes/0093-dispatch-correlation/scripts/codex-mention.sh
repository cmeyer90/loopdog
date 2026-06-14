#!/usr/bin/env bash
# THROWAWAY spike script (task 0093). Dispatches Codex cloud by posting a
# @codex mention comment on an issue, and records the dispatch-time signal
# (comment id + window start) for correlation scoring.
#
# Required env:
#   GH_TOKEN     a token `gh` can use (GITHUB_TOKEN in Actions is fine)
#   SPIKE_REPO   owner/name of the scratch repo
# Optional env:
#   SPIKE_ISSUE   issue number to comment on (default 1)
#   SPIKE_RUN_ID  correlation run id (default: GITHUB_RUN_ID or epoch seconds)
#   SPIKE_OUT     output dir (default ./spike-runs)
set -euo pipefail

: "${SPIKE_REPO:?missing owner/name}"
ISSUE="${SPIKE_ISSUE:-1}"
RUN_ID="${SPIKE_RUN_ID:-${GITHUB_RUN_ID:-$(date +%s)}}"
OUT_DIR="${SPIKE_OUT:-./spike-runs}"
mkdir -p "$OUT_DIR"

BRANCH="loopdog/spike/${ISSUE}-${RUN_ID}"

BODY=$(cat <<EOF
@codex Spike trial ${RUN_ID}. Create a file spike-output/trial-${RUN_ID}.txt
containing the single line "spike ${RUN_ID}", on a NEW branch named exactly
"${BRANCH}", and open a pull request titled "spike: trial ${RUN_ID}" whose body
ends with the exact trailer line:

loopdog-run: ${RUN_ID}

Do nothing else. Do not modify any other file.
EOF
)

echo "posting @codex mention for run ${RUN_ID} on ${SPIKE_REPO}#${ISSUE}..."
COMMENT_JSON=$(gh api "repos/${SPIKE_REPO}/issues/${ISSUE}/comments" -f body="$BODY")
COMMENT_ID=$(echo "$COMMENT_JSON" | jq -r '.id')
COMMENT_AT=$(echo "$COMMENT_JSON" | jq -r '.created_at')

jq -n \
  --arg run_id "$RUN_ID" \
  --arg issue "$ISSUE" \
  --arg branch "$BRANCH" \
  --arg comment_id "$COMMENT_ID" \
  --arg comment_at "$COMMENT_AT" \
  '{provider: "codex", run_id: $run_id, issue: $issue,
    expected_branch: $branch, expected_trailer: ("loopdog-run: " + $run_id),
    dispatch_comment_id: $comment_id, fired_at: $comment_at}' \
  > "$OUT_DIR/dispatch-${RUN_ID}.json"

echo "dispatch record: $OUT_DIR/dispatch-${RUN_ID}.json (comment ${COMMENT_ID})"
