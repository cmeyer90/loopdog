#!/usr/bin/env bash
# THROWAWAY spike script (task 0093). Scores correlation honor-rates: for each
# dispatch record in SPIKE_OUT, did a PR appear whose head branch matches the
# expected branch, and whose body contains the expected trailer?
#
# Required env: GH_TOKEN, SPIKE_REPO (owner/name)
# Optional env: SPIKE_OUT (default ./spike-runs)
set -euo pipefail

: "${SPIKE_REPO:?missing owner/name}"
OUT_DIR="${SPIKE_OUT:-./spike-runs}"

PRS=$(gh api --paginate "repos/${SPIKE_REPO}/pulls?state=all&per_page=100" \
  | jq -s 'add | map({number, head_ref: .head.ref, body: (.body // ""), actor: .user.login, created_at})')

total=0; branch_ok=0; trailer_ok=0; both_ok=0; none=0
printf '%-28s %-8s %-8s %-8s %s\n' "run_id" "branch" "trailer" "pr" "actor"

for f in "$OUT_DIR"/dispatch-*.json; do
  [ -e "$f" ] || { echo "no dispatch records in $OUT_DIR" >&2; exit 1; }
  total=$((total+1))
  run_id=$(jq -r '.run_id' "$f")
  want_branch=$(jq -r '.expected_branch' "$f")
  want_trailer=$(jq -r '.expected_trailer' "$f")

  match=$(echo "$PRS" | jq --arg b "$want_branch" --arg t "$want_trailer" --arg r "$run_id" \
    'map(select(.head_ref == $b or (.body | contains($t)) or (.body | contains($r))))')
  n=$(echo "$match" | jq 'length')
  if [ "$n" -eq 0 ]; then
    none=$((none+1))
    printf '%-28s %-8s %-8s %-8s %s\n' "$run_id" "-" "-" "MISSING" "-"
    continue
  fi
  pr=$(echo "$match" | jq '.[0]')
  b_ok=$(echo "$pr" | jq --arg b "$want_branch" '.head_ref == $b')
  t_ok=$(echo "$pr" | jq --arg t "$want_trailer" '.body | contains($t)')
  [ "$b_ok" = "true" ] && branch_ok=$((branch_ok+1))
  [ "$t_ok" = "true" ] && trailer_ok=$((trailer_ok+1))
  [ "$b_ok" = "true" ] && [ "$t_ok" = "true" ] && both_ok=$((both_ok+1))
  printf '%-28s %-8s %-8s %-8s %s\n' "$run_id" "$b_ok" "$t_ok" \
    "$(echo "$pr" | jq -r '.number')" "$(echo "$pr" | jq -r '.actor')"
done

echo
echo "trials:           $total"
echo "branch honored:   $branch_ok/$total"
echo "trailer honored:  $trailer_ok/$total"
echo "both honored:     $both_ok/$total"
echo "no PR found:      $none/$total"
echo
echo "Decision input for 0073: if 'both honored' < total, correlation MUST also key"
echo "off the dispatch-time signal (fire response session id / mention comment id)."
