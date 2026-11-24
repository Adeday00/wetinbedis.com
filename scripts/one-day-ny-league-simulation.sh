#!/bin/zsh

# One-day only, three-round League simulation in America/New_York time.
# It provisions three *distinct* rounds so that each window behaves like a
# separate week: one verified entry, a separate leaderboard, review queue,
# prize ladder, and eventual winner announcement.
set -euo pipefail

ORIGIN="${WBD_ORIGIN:-https://admin.wetinbedis.com}"
TOKEN="${WBD_CONTENT_ADMIN_TOKEN:-}"
NY_DATE="${NY_DATE:-$(TZ=America/New_York date +%F)}"
# false is intentional: set CASH_ENABLED=true only when the operator is ready
# for the Worker’s independently enforced cash-launch gates.
CASH_ENABLED="${CASH_ENABLED:-false}"
PRESTART_MINUTES="${PRESTART_MINUTES:-10}"

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(security find-generic-password -a "$USER" -s "WBD_CONTENT_ADMIN_TOKEN" -w 2>/dev/null || true)"
fi
if [[ -z "$TOKEN" ]]; then
  print -u2 "WBD_CONTENT_ADMIN_TOKEN is not set and was not found in Keychain."
  exit 1
fi
if [[ "$CASH_ENABLED" != "true" && "$CASH_ENABLED" != "false" ]]; then
  print -u2 "CASH_ENABLED must be true or false."
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  print -u2 "jq is required. Install it with: brew install jq"
  exit 1
fi

utc_for_ny() {
  local local_time="$1"
  local epoch
  epoch="$(TZ=America/New_York date -j -f '%Y-%m-%d %H:%M' "$NY_DATE $local_time" +%s)"
  date -u -r "$epoch" '+%Y-%m-%dT%H:%M:%SZ'
}

epoch_for_utc() { date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s; }

sleep_until() {
  local target="$1"
  local seconds=$(( $(epoch_for_utc "$target") - $(date +%s) ))
  if (( seconds > 0 )); then
    sleep "$seconds"
  fi
}

starts=("15:00" "16:30" "18:00")
ends=("16:00" "17:30" "19:30")
slugs=("odogwu-ny-${NY_DATE}-round-1" "odogwu-ny-${NY_DATE}-round-2" "odogwu-ny-${NY_DATE}-round-3")
titles=("Odogwu League — NY Simulation Week 1" "Odogwu League — NY Simulation Week 2" "Odogwu League — NY Simulation Week 3")

config_file="$(mktemp -t wbd-one-day-league).json"
trap 'rm -f "$config_file"' EXIT INT TERM
curl -fsS "$ORIGIN/api/v1/app-config" > "$config_file"
next_revision="$(jq -r '.revision + 1' "$config_file")"

provision_round() {
  local index="$1" starts_at="$2" ends_at="$3"
  curl -fsS -X POST "$ORIGIN/api/v1/admin/competitions/one-day-simulation" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg slug "${slugs[$index]}" --arg title "${titles[$index]}" --arg starts_at "$starts_at" --arg ends_at "$ends_at" '{slug:$slug,title:$title,starts_at:$starts_at,ends_at:$ends_at}')"
}

publish_state() {
  local entry_enabled="$1" starts_at="$2" ends_at="$3" headline="$4"
  local mode="practice"
  [[ "$CASH_ENABLED" == "true" ]] && mode="cash_ready"
  local config draft review published
  config="$(jq \
    --arg published_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --arg starts "$starts_at" --arg ends "$ends_at" --arg headline "$headline" --arg mode "$mode" \
    --argjson revision "$next_revision" --argjson entry_enabled "$entry_enabled" --argjson cash_enabled "$CASH_ENABLED" \
    '.revision = $revision | .published_at = $published_at
     | .home.event_banner = {event_id:"odogwu-ny-one-day-simulation",headline:$headline,artwork_url:null,starts_at:$starts,ends_at:$ends}
     | .events.odogwu_league.enabled = true | .events.odogwu_league.entry_enabled = $entry_enabled
     | .events.odogwu_league.visible_from = $published_at | .events.odogwu_league.starts_at = $starts | .events.odogwu_league.ends_at = $ends
     | .events.odogwu_league.mode = $mode | .events.odogwu_league.home_placement = "card"
     | .events.odogwu_league.headline = $headline | .events.odogwu_league.cash_enabled = $cash_enabled
     | .events.odogwu_league.weekly_schedule = null' "$config_file")"
  draft="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/app-config/draft" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$(jq -cn --arg reason "One-day NY League simulation revision $next_revision" --argjson config "$config" '{reason:$reason,config:$config}')")"
  [[ "$(jq -r '.saved' <<< "$draft")" == "true" ]] || { print -u2 "$draft"; exit 1; }
  review="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/app-config/review" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$(jq -cn --arg reason "Review NY League simulation revision $next_revision" --argjson revision "$next_revision" '{reason:$reason,revision:$revision}')")"
  [[ "$(jq -r '.reviewed' <<< "$review")" == "true" ]] || { print -u2 "$review"; exit 1; }
  published="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/app-config/publish" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$(jq -cn --arg reason "Publish NY League simulation revision $next_revision" --argjson config "$config" '{reason:$reason,config:$config}')")"
  [[ "$(jq -r '.published' <<< "$published")" == "true" ]] || { print -u2 "$published"; exit 1; }
  cp "$config_file" "$config_file.next" && mv "$config_file.next" "$config_file"
  print "published revision=$next_revision entry_enabled=$entry_enabled $starts_at → $ends_at"
  next_revision=$((next_revision + 1))
}

notify() {
  local event="$1" competition_id="$2"
  curl -fsS -X POST "$ORIGIN/api/v1/admin/notifications/league-broadcast" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg event "$event" --arg competition_id "$competition_id" '{event:$event,competition_id:$competition_id}')" \
    || print -u2 "warning: APNs notification failed for $event ($competition_id)"
}

round_ids=()
for index in 1 2 3; do
  start_at="$(utc_for_ny "${starts[$index]}")"; end_at="$(utc_for_ny "${ends[$index]}")"
  response="$(provision_round "$index" "$start_at" "$end_at")"
  round_ids[$index]="$(jq -r '.competition.id' <<< "$response")"
  print "provisioned week $index: ${round_ids[$index]} ($start_at → $end_at)"
done

for index in 1 2 3; do
  start_at="$(utc_for_ny "${starts[$index]}")"; end_at="$(utc_for_ny "${ends[$index]}")"
  prestart_at="$(date -u -r $(( $(epoch_for_utc "$start_at") - PRESTART_MINUTES * 60 )) '+%Y-%m-%dT%H:%M:%SZ')"
  sleep_until "$prestart_at"
  publish_state false "$start_at" "$end_at" "Odogwu League opens at ${starts[$index]} NY time"
  notify starts_soon "${round_ids[$index]}"
  sleep_until "$start_at"
  publish_state true "$start_at" "$end_at" "Odogwu League is live until ${ends[$index]} NY time"
  notify started "${round_ids[$index]}"
  # One strategic reminder, ten minutes before the end, only for players who
  # have not submitted this exact round.
  close_reminder="$(date -u -r $(( $(epoch_for_utc "$end_at") - 10 * 60 )) '+%Y-%m-%dT%H:%M:%SZ')"
  sleep_until "$close_reminder"
  notify closing_soon "${round_ids[$index]}"
  sleep_until "$end_at"
  if (( index < 3 )); then
    next_start="$(utc_for_ny "${starts[$((index + 1))]}")"; next_end="$(utc_for_ny "${ends[$((index + 1))]}")"
    publish_state false "$next_start" "$next_end" "Round closed · next Odogwu League opens at ${starts[$((index + 1))]} NY time"
  else
    publish_state false "$end_at" "$end_at" "Today’s Odogwu League simulation has closed"
  fi
  notify closed "${round_ids[$index]}"
  print "Round $index is now in review. After reviewing results, announce with:"
  print "curl -fsS -X POST '$ORIGIN/api/v1/admin/notifications/league-broadcast' -H 'Authorization: Bearer \$WBD_CONTENT_ADMIN_TOKEN' -H 'Content-Type: application/json' --data '{\"event\":\"results_ready\",\"competition_id\":\"${round_ids[$index]}\"}'"
done

print "One-day NY League simulation complete. Winners must be reviewed before results_ready or payout requests are sent."
