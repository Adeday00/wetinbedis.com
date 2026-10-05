# Wetin Be Dis remote operations runbook

The owner API is deliberately authenticated and does not expose an admin dashboard. Set `WBD_CONTENT_ADMIN_TOKEN` (or the approved owner identity allowlists) on the Worker. Bearer requests must use the Worker origin and a token of at least 16 characters.

## Draft, review, validate, and publish app configuration

Create a JSON document with `schema_version: 1`, an increasing `revision`, WAT/UTC ISO timestamps, approved category and release IDs, and an Odogwu League event. `cash_enabled` must remain `false`; `mode: "cash_ready"` is only a readiness label and does not enable prizes.

```sh
curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/app-config/draft" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"reason":"Prepare the reviewed practice League schedule","config":'"$(cat app-config.json)"'}'

curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/app-config/review" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"revision":12,"reason":"Editorial and operations review complete"}'

curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/app-config/validate" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data @app-config.json

curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/app-config/publish" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"reason":"Schedule the reviewed practice League","config":'"$(cat app-config.json)"'}'
```

Clients fetch `GET /api/v1/app-config` at launch/foreground boundaries. The response is ETagged and clients retain the last validated snapshot offline. A malformed or unavailable response leaves the safe default active.

Content releases use the same owner authorization. Validate and publish through `/api/v1/admin/content/releases/validate` and `/api/v1/admin/content/releases/publish`; use `/api/v1/admin/content/releases/rollback` or `/api/v1/admin/content/releases/revoke` with `{ "release_id": "...", "reason": "..." }` for an approved recovery or kill switch. Content status changes are recorded in the content-release audit table.

## Emergency disable, rollback, and revoke

```sh
curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/app-config/disable" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"reason":"Pause League placement while investigating an incident"}'

curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/app-config/rollback" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"revision":12,"reason":"Restore the last reviewed configuration"}'

curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/app-config/revoke" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"revision":13,"reason":"Revoke a configuration containing an invalid release reference"}'
```

Every mutation writes an audit row containing the actor, action, revision, timestamp, reason, and details. Revoke or disable before removing a content release that is already referenced by a published configuration.

## Practice League schedule

1. Validate and publish the reviewed content release with the content workflow.
2. Publish app configuration with `enabled: true`, the WAT schedule, `mode: "practice"`, `home_placement: "banner"` or `"card"`, and `cash_enabled: false`.
3. Confirm `GET /api/v1/app-config` returns the expected revision and `cash_enabled: false`.
4. Confirm `GET /api/v1/competitions/current` presents practice copy and no payable result.
5. Use the event health, invalid-attempt, and review tooling before communicating the event publicly.

## Cash-prize readiness

Cash cannot be enabled by remote configuration. Before any prize event, the owner must independently complete legal review for each jurisdiction, adult Nigeria-first eligibility, identity/sanctions/fraud and payout verification, App Attest, Play Integrity, abuse controls, server timing/scoring, winner review, appeals, privacy/retention/deletion operations, support, confirmed prize funding, and tested emergency cancellation. Until every gate is implemented and accepted by the server, the API must continue to expose practice/no-cash behavior.

## Cash review and payout records

When cash mode is eventually approved, use the restricted operations endpoints documented in `wbd-site/docs/CashOperationsAPI.md`:

- Queue and review attempts at `/api/v1/admin/cash/reviews`.
- Create only a cleared, confirmed prize record at `/api/v1/admin/cash/payouts`.
- Require a different operator for approval and release, and record the OPay transfer reference when marking a payout sent.

Do not put bank or wallet details in the app profile, public leaderboard, social messages, or competition tables. Store those details only in the approved payout channel.
