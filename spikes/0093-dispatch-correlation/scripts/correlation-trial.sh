#!/usr/bin/env bash
# THROWAWAY spike script (task 0093). Runs N dispatch trials for one provider,
# spaced to respect subscription rate caps (Codex cloud ≈5 tasks/hr on lower
# tiers; Claude routines have daily caps).
#
# Usage: ./correlation-trial.sh <claude|codex> [N] [sleep_seconds]
set -euo pipefail

PROVIDER="${1:?usage: correlation-trial.sh <claude|codex> [N] [sleep_seconds]}"
N="${2:-10}"
SLEEP="${3:-900}"   # 15 min default spacing — stays under ~5/hr
HERE="$(cd "$(dirname "$0")" && pwd)"

for i in $(seq 1 "$N"); do
  export SPIKE_RUN_ID="trial-$(date +%s)-${i}"
  echo "=== ${PROVIDER} trial ${i}/${N} (run_id=${SPIKE_RUN_ID}) ==="
  case "$PROVIDER" in
    claude) "$HERE/claude-fire.sh" ;;
    codex)  "$HERE/codex-mention.sh" ;;
    *) echo "unknown provider: $PROVIDER" >&2; exit 1 ;;
  esac
  [ "$i" -lt "$N" ] && sleep "$SLEEP"
done
echo "all ${N} ${PROVIDER} trials dispatched; wait for PRs, then run correlation-score.sh"
