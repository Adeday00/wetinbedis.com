#!/bin/zsh

set -euo pipefail

ORIGIN="${WBD_ORIGIN:-https://admin.wetinbedis.com}"
TOKEN="${WBD_CONTENT_ADMIN_TOKEN:-}"
COMPETITION_ID="${COMPETITION_ID:-}"

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(security find-generic-password -a "$USER" -s "WBD_CONTENT_ADMIN_TOKEN" -w 2>/dev/null || true)"
fi
if [[ -z "$TOKEN" || -z "$COMPETITION_ID" ]]; then
  print -u2 "Set WBD_CONTENT_ADMIN_TOKEN and COMPETITION_ID before running this script."
  exit 1
fi

curl -fsS -X POST "$ORIGIN/api/v1/admin/cash/competitions/$COMPETITION_ID/eligible-countries" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"eligible_countries":["US","NG","CA","GB"],"note":"Owner-approved Odogwu League policy: United States, Nigeria, Canada, and United Kingdom; minimum age 18; prizes remain NGN."}'
