#!/bin/zsh

set -euo pipefail

# Internal device rehearsal loop. It publishes a real server-owned window,
# then a short closed interval that advertises the next opening time.
ORIGIN="${WBD_ORIGIN:-https://admin.wetinbedis.com}"
TOKEN="${WBD_CONTENT_ADMIN_TOKEN:-}"
# Odogwu rehearsal cadence: 10 minutes open, then 2 minutes closed before
# the next server-owned round begins. Override these for a shorter test.
OPEN_MINUTES="${OPEN_MINUTES:-10}"
CLOSED_MINUTES="${CLOSED_MINUTES:-2}"
CLOSING_REMINDER_MINUTES="${CLOSING_REMINDER_MINUTES:-2}"
# Zero means keep cycling until the operator stops the script with Ctrl-C.
CYCLES="${CYCLES:-0}"

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(security find-generic-password -a "$USER" -s "WBD_CONTENT_ADMIN_TOKEN" -w 2>/dev/null || true)"
fi
if [[ -z "$TOKEN" ]]; then
  print -u2 "WBD_CONTENT_ADMIN_TOKEN is not set and was not found in Keychain."
  exit 1
fi

if ! [[ "$OPEN_MINUTES" == <-> && "$OPEN_MINUTES" -gt 1 \
    && "$CLOSED_MINUTES" == <-> && "$CLOSED_MINUTES" -gt 0 \
    && "$CLOSING_REMINDER_MINUTES" == <-> && "$CLOSING_REMINDER_MINUTES" -gt 0 \
    && "$CLOSING_REMINDER_MINUTES" -lt "$OPEN_MINUTES" \
    && "$CYCLES" == <-> && "$CYCLES" -ge 0 ]]; then
  print -u2 "OPEN_MINUTES must exceed CLOSING_REMINDER_MINUTES; CLOSED_MINUTES must be positive and CYCLES must be zero or a positive integer."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  print -u2 "jq is required. Install it with: brew install jq"
  exit 1
fi

base_config="$(mktemp -t wbd-league-cycle).json"
trap 'rm -f "$base_config"' EXIT INT TERM
curl -fsS "$ORIGIN/api/v1/app-config" > "$base_config"
next_revision="$(jq -r '.revision + 1' "$base_config")"

publish_config() {
  local entry_enabled="$1"
  local published_at="$2"
  local config_starts="$3"
  local config_ends="$4"
  local competition_starts="$5"
  local competition_ends="$6"
  local notification_event="$7"
  local config draft review published competition_window notification_response

  config="$(jq \
    --arg published_at "$published_at" \
    --arg starts "$config_starts" \
    --arg ends "$config_ends" \
    --argjson revision "$next_revision" \
    --argjson entry_enabled "$entry_enabled" \
    '.revision = $revision
     | .published_at = $published_at
     | .home.event_banner = (if $entry_enabled then {
         event_id: "odogwu-league-practice-cycle",
         headline: "INTERNAL TEST · Odogwu League",
         artwork_url: null,
         starts_at: $starts,
         ends_at: $ends
       } else null end)
     | .events.odogwu_league.enabled = true
     | .events.odogwu_league.entry_enabled = $entry_enabled
     | .events.odogwu_league.visible_from = $published_at
     | .events.odogwu_league.starts_at = $starts
     | .events.odogwu_league.ends_at = $ends
     | .events.odogwu_league.mode = "practice"
     | .events.odogwu_league.home_placement = (if $entry_enabled then "banner" else "card" end)
     | .events.odogwu_league.headline = (if $entry_enabled then "INTERNAL TEST · Odogwu League" else "Final standings · next round starts soon" end)
     | .events.odogwu_league.cash_enabled = false' \
    "$base_config")"

  draft="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/app-config/draft" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg reason "Practice cycle revision $next_revision" --argjson config "$config" '{reason:$reason,config:$config}')")"
  [[ "$(jq -r '.saved' <<< "$draft")" == "true" ]] || { print -u2 "$draft"; exit 1; }

  review="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/app-config/review" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg reason "Review practice cycle revision $next_revision" --argjson revision "$next_revision" '{reason:$reason,revision:$revision}')")"
  [[ "$(jq -r '.reviewed' <<< "$review")" == "true" ]] || { print -u2 "$review"; exit 1; }

  published="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/app-config/publish" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg reason "Publish practice cycle revision $next_revision" --argjson config "$config" '{reason:$reason,config:$config}')")"
  [[ "$(jq -r '.published' <<< "$published")" == "true" ]] || { print -u2 "$published"; exit 1; }

  competition_window="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/competitions/rehearsal-window" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$(jq -cn --argjson enabled "$entry_enabled" --arg starts_at "$competition_starts" --arg ends_at "$competition_ends" '{enabled:$enabled,starts_at:$starts_at,ends_at:$ends_at}')")"
  print "competition=$competition_window"
  competition_id="$(jq -r '.competition.id' <<< "$competition_window")"

  if ! notification_response="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/notifications/league-test" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg event "$notification_event" --arg competition_id "$competition_id" '{event:$event,competition_id:$competition_id}')")"; then
    print -u2 "warning: config published, but APNs notification delivery failed for event=$notification_event"
  else
    print "notification=$notification_response"
  fi

  print "revision=$next_revision hard_kill=false entry_enabled=$entry_enabled starts=$config_starts ends=$config_ends event=$notification_event"
  next_revision=$((next_revision + 1))
}

cycle=1
while (( CYCLES == 0 || cycle <= CYCLES )); do
  opened_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  entries_close_at="$(date -u -v "+${OPEN_MINUTES}M" '+%Y-%m-%dT%H:%M:%SZ')"
  publish_config true "$opened_at" "$opened_at" "$entries_close_at" "$opened_at" "$entries_close_at" "started"

  sleep $(((OPEN_MINUTES - CLOSING_REMINDER_MINUTES) * 60))
  reminder_response="$(curl -fsS -X POST "$ORIGIN/api/v1/admin/notifications/league-test" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg competition_id "$competition_id" '{event:"closing_soon",competition_id:$competition_id}')")"
  print "notification=$reminder_response"

  sleep $((CLOSING_REMINDER_MINUTES * 60))
  closed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  next_open_at="$(date -u -v "+${CLOSED_MINUTES}M" '+%Y-%m-%dT%H:%M:%SZ')"
  next_entries_close_at="$(date -u -v "+$((CLOSED_MINUTES + OPEN_MINUTES))M" '+%Y-%m-%dT%H:%M:%SZ')"
  publish_config false "$closed_at" "$next_open_at" "$next_entries_close_at" "$closed_at" "$next_open_at" "closed"
  sleep $((CLOSED_MINUTES * 60))
  cycle=$((cycle + 1))
done

if (( CYCLES > 0 )); then
  print "Practice cycle complete. The last published state is closed."
fi
