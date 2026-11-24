# Wetin Be Dis remote operations runbook

The owner API is deliberately authenticated and does not expose an admin dashboard. Set `WBD_CONTENT_ADMIN_TOKEN` (or the approved owner identity allowlists) on the Worker. Bearer requests must use the Worker origin and a token of at least 16 characters.

## Read-only League card preview

The iOS owner preview uses a separate Worker secret, `WBD_CARD_PREVIEW_TOKEN`. Generate a high-entropy value, store it only in the Worker secret store, and never commit it or place it in the app binary:

```sh
npx wrangler secret put WBD_CARD_PREVIEW_TOKEN
```

The phone accepts this token once in Settings → the hidden owner tools → Silent card preview and stores it in the iOS Keychain. The endpoint is read-only and returns the currently open published League pack, including the locked answer key for owner QA. It does not create an attempt, score, leaderboard row, notification, or payout. Rotate the secret to revoke every configured device.

## Draft, review, validate, and publish app configuration

Create a JSON document with `schema_version: 1`, an increasing `revision`, WAT/UTC ISO timestamps, approved category and release IDs, and an Odogwu League event. Keep `cash_enabled: false` for all practice activity. It can be `true` only after every restricted cash launch gate has a passed evidence record; the Worker independently enforces those gates.

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

## League push notifications

`POST /api/v1/admin/notifications/league-broadcast` sends the custom League
start, closing-soon, or closed notification only to iOS devices that explicitly
enabled League updates. For `closing_soon`, a competition ID is required; only
players who have not submitted that exact round are selected. The endpoint
rejects a closing-soon send without it:

```json
{
  "event": "closing_soon",
  "competition_id": "weekly-league-2026-11-11"
}
```

`started` and `closed` do not require a competition ID. The endpoint reports
eligible, sent, failed, and APNs-invalid tokens removed; it never returns a
device token. APNs delivery refuses to run without an explicit
`WBD_APNS_BUNDLE_ID` and `WBD_APNS_HOST`. For a production broadcast, set
`WBD_APNS_HOST` to `https://api.push.apple.com`. Use
`https://api.sandbox.push.apple.com` only for an Xcode-installed development
build; there is deliberately no sandbox default.

### One-day New York simulation

For a one-day rehearsal that behaves as three independent weekly rounds, use
the checked-in scheduler. It creates three server-owned competitions from the
reviewed private League pack; it never copies cards from public Today’s 5.
The default schedule is **today in America/New_York**:

- 3:00–4:00 PM
- 4:30–5:30 PM
- 6:00–7:30 PM

Each window has a separate attempt limit, leaderboard, review queue, and the
fixed NGN ladder: ₦50,000 / ₦30,000 / ₦20,000. It sends one upcoming notice,
one opening notice, one ten-minute closing reminder only to players who have
not submitted, and one close/review notice. It does not announce winners
automatically: scores must be reviewed first.

```sh
cd "/Users/davidadekanbi/Documents/Documents - David’s Mac mini - 1/Xcode/WetinBeDis/wbd-site"
CASH_ENABLED=true zsh ./scripts/one-day-ny-league-simulation.sh
```

`CASH_ENABLED=true` requests cash mode, but the Worker still refuses entry if
any independently recorded launch gate is not passed. To run the exact same
flow without cash eligibility, omit it (the default is `false`). Keep the
Terminal window open until 7:30 PM New York time.

After reviewing a completed round, announce confirmed standings with:

```sh
curl -fsS -X POST "$WBD_ORIGIN/api/v1/admin/notifications/league-broadcast" \
  -H "Authorization: Bearer $WBD_CONTENT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"event":"results_ready","competition_id":"ROUND_COMPETITION_ID"}'
```

Create the pending payout record only for each confirmed, cleared winner.
That action sends the winner-only secure payout-details notification; it does
not place bank details in the leaderboard or a push notification.

## Cash-prize readiness

Cash cannot be enabled by remote configuration alone. Before any prize event,
the owner must record a passed status and restricted evidence reference for
every Worker launch gate (rules/eligibility, phone verification, iOS App
Attest, Android Play Integrity, trusted timing/private content, fraud review,
payout/funding, privacy/retention, and production incident testing). Each
decision is retained in the gate audit history with its restricted evidence
reference. Only then
may the owner publish `cash_enabled: true`. If a gate returns to `pending` or
`failed`, the Worker blocks new public cash entry while allowing an already
issued 96-second attempt to finish against its server deadline.

## Cash review and payout records

When cash mode is eventually approved, use the restricted operations endpoints documented in `wbd-site/docs/CashOperationsAPI.md`:

- Queue and review attempts at `/api/v1/admin/cash/reviews`.
- Create only a cleared, confirmed prize record at `/api/v1/admin/cash/payouts`.
- Require a different operator for approval and release, and record the OPay transfer reference when marking a payout sent.

Do not put bank or wallet details in the app profile, public leaderboard, social messages, or competition tables. Store those details only in the approved payout channel.


### General iOS announcements

In **Notifications**, select **General announcement (iOS)**, enter both a title
(up to 80 characters) and message (up to 240), review the audience count, then
send. This calls `POST /api/v1/admin/notifications/announcement-broadcast` with
`{ "title": "…", "body": "…" }`. Owner authorization and origin checks apply.
Only registered iOS devices with `offers_enabled = 1` are eligible (the app's
**New decks and offers** preference). League opt-in alone does not qualify.
No competition, League banner, League route, or sponsor image is attached.
Tapping opens the installed app without requesting League navigation; existing
app navigation remains unchanged. No App Store update is needed.
Delivery totals mean APNs accepted or rejected the request, not confirmed views.
Invalid APNs tokens are removed and every send is recorded in the audit log.
The notification status response includes `announcements` with eligible iOS
device and distinct-player counts, separate from the existing League counts.
