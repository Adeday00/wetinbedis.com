# Cash Operations API

> Deployment order: apply migrations `0015_apple_app_attest.sql` through
> `0022_cash_launch_gate_audit.sql` before deploying Worker code that uses these
> controls. Until the evidence records are present and every required gate is
> passed, cash attempts remain unavailable.

All endpoints below are owner-only. They require the existing content-admin authorization and same-origin protection for signed-in owner requests. They are preparation and audit tools; they do not enable cash mode.

## Cash launch evidence gates

`GET /api/v1/admin/cash/launch-gates`

`POST /api/v1/admin/cash/launch-gates/{gate_key}`

The Worker requires every one of these gates to be `passed` with a non-empty
restricted evidence reference before a public cash attempt can start:

- `official_rules_and_eligibility`
- `phone_verification`
- `ios_app_attest`
- `android_play_integrity`
- `trusted_timing_and_private_content`
- `fraud_review_operations`
- `payout_operations_and_funding`
- `privacy_retention_and_deletion`
- `production_tests_and_incident_response`

The owner-only `GET` response includes both the current status for each gate
and its immutable `audit` decision history, newest first.

```json
{
  "status": "passed",
  "evidence_reference": "restricted-launch-evidence/ios-attest-pilot-2026-11",
  "note": "Physical-device registration and per-answer assertions passed the approved pilot cases."
}
```

The reference identifies approved evidence without copying sensitive records
into D1. Every gate change is retained in the restricted, append-only
`cash_launch_gate_audit` record with its reviewer, note, reference, and
timestamp; current gate rows are only a convenient readiness view. Passing
every gate only makes cash *eligible* for release: the
published app configuration must also explicitly set `cash_enabled: true`.
Marking a gate `failed` or `pending` immediately blocks new public cash entry;
it does not invalidate an already-issued 96-second attempt.

### Minimum evidence per launch gate

| Gate | Evidence reference must identify |
| --- | --- |
| `official_rules_and_eligibility` | Published rules version, approved jurisdictions, age rule, and eligibility review procedure. |
| `phone_verification` | Physical-device SMS verification and profile-save test for every enabled country. |
| `ios_app_attest` | Physical iPhone registration and per-answer assertion results for the production environment. |
| `android_play_integrity` | Production Android integrity-verification results, or an approved platform-scope decision that removes Android cash entry. |
| `trusted_timing_and_private_content` | Sequential-card, expiry, resume, answer-key isolation, and concurrency test results. |
| `fraud_review_operations` | Queue ownership, decision procedure, appeal path, and completed operator drill. |
| `payout_operations_and_funding` | NGN prize funding confirmation, payout-provider procedure, limits, reconciliation, and dual-control drill. |
| `privacy_retention_and_deletion` | Published jurisdiction-specific retention schedule, privacy-request exercise, deletion/anonymization procedure, and legal-hold procedure. |
| `production_tests_and_incident_response` | Production smoke-test evidence, monitoring/on-call ownership, rollback/kill-switch drill, and cancellation messaging exercise. |

## Recorded Odogwu owner policy

The owner-approved product launch inputs are recorded in
`docs/odogwu-owner-approval.json`: iOS-only cash scope, minimum age 18,
eligible countries `US`, `NG`, `CA`, and `GB`, and NGN prizes. This is an
owner approval record; it is not a storage location for legal documents,
identity records, payout credentials, or bank details.

The Worker enforces that scope. Unless `WBD_ANDROID_CASH_ENTRY_ENABLED=true` is
explicitly configured, Android receives no public cash/prize capability in the
current-round response and its public prize-attempt route returns
`android_cash_entry_not_approved`. The internal rehearsal remains available
for Android QA and is non-payable. Leave the variable unset under the current
iOS-only approval. Set it only after the owner approves Android prize entry
and the Android integrity launch gate has production evidence; passing that
gate alone does not change the approved platform scope.

## Competition country policy

`POST /api/v1/admin/cash/competitions/{competition_id}/eligible-countries`

For the recorded Odogwu policy, run
`scripts/apply-odogwu-country-policy.sh` with the scheduled competition ID.
The endpoint rejects an already-open competition so the country policy cannot
change while entries are being accepted.

Use this only while a cash competition is `draft` or `scheduled`; an open,
locked, final, or cancelled competition cannot be changed. This preserves a
stable entry policy for every player. The request is audited and does not alter
the prize currency: public cash League prizes are restricted to `NGN`. Country codes use ISO alpha-2: use `GB` for the United
Kingdom, not `UK`.

Eligible countries describe where a player may enter; they do **not** by
themselves approve a payout route. Every winner's prize and payout remains
denominated in NGN: this League does not automatically convert prizes into a
different currency. Before adding a country, the payout-operations evidence
must identify the provider's supported NGN settlement path and recipient
requirements for that country. Do not pass the payout gate on the assumption
that an entry-country allowlist makes cross-border NGN disbursement available.

```json
{
  "eligible_countries": ["US", "NG", "CA", "GB"],
  "note": "Approved pre-opening policy: United States, Nigeria, Canada, and United Kingdom; all prizes remain NGN."
}
```

## Review queue

## Player eligibility decisions

`POST /api/v1/admin/cash/players/{player_id}/eligibility`

This is the only route that can move a phone-verified player from `pending` to
`eligible`. The player must already have accepted the exact supplied rules
version. The restricted operator must provide a non-empty review note and one
of `eligible`, `ineligible`, or `suspended`:

```json
{
  "status": "eligible",
  "rules_version": "league-week-1-v1",
  "note": "Identity, age, location, duplicate-account, and payout checks completed in the restricted operations process."
}
```

Every decision is appended to `player_eligibility_reviews`. Do not put identity
documents, bank details, sanctions data, or raw phone numbers in the note or
the competition database.

`GET /api/v1/admin/cash/reviews?competition_id=...&status=queued`

Returns queued reviews with attempt, competition, pseudonymous player handle, risk score, flags, and prior decision metadata. It never returns phone numbers, identity documents, bank details, or card text.

`POST /api/v1/admin/cash/reviews/{review_id}`

Body:

```json
{
  "status": "in_review",
  "note": "Checked timing and duplicate-account signals."
}
```

Reviews begin as `queued`, can move to `in_review`, `cleared`, or `voided`, and a `cleared` or `voided` decision is final. Every decision requires a note and is written to the attempt plus the review record.

Every cash score enters this queue as provisional. The service records the
server-timed score plus review-only signals for unusually rapid answers,
repeated response latencies, and an unusually short whole-round duration.
Those signals never disqualify a player automatically; a reviewer must record
the outcome. A score remains ineligible for payout until it is cleared.

## Payout records

`GET /api/v1/admin/cash/payouts?competition_id=...`

Returns payout records with each record's chronological `audit` trail (creation,
approval, release, cancellation, or failure). Bank details are intentionally
absent; an audit entry may contain only the provider transfer reference needed
for reconciliation.

`POST /api/v1/admin/cash/payouts`

Creates a pending payout only when the attempt is confirmed, the review is cleared, and the amount matches the published prize configuration. The operator who cleared the review cannot create that payout record.

`POST /api/v1/admin/cash/payouts/{payout_id}/status`

Body:

```json
{
  "status": "approved",
  "note": "Second operator approved the verified winner."
}
```

Allowed states are `pending`, `approved`, `sent`, `failed`, and `cancelled`. A
record can move only from `pending` to `approved`, `failed`, or `cancelled`,
and from `approved` to `sent`, `failed`, or `cancelled`. `sent` requires a
provider transfer reference. Approval and release require different authorized
operators so a single account cannot silently approve and release its own
payout. `sent`, `failed`, and `cancelled` records are final.

The player-facing endpoint `POST /api/v1/me/cash/payout-details` accepts the
legal name, bank name, account number, and country only after a pending payout
record exists. The Worker encrypts those details with
`WBD_PAYOUT_DATA_ENCRYPTION_SECRET` in the separate `competition_payout_details`
vault table; normal competition and payout records never contain the account
number. An individually attributable operator can read the restricted queue at
`GET /api/v1/admin/cash/payout-details?competition_id=...` for manual review.
After review, record only the provider transfer reference on the payout record.

Before deployment, configure `WBD_PAYOUT_DATA_ENCRYPTION_SECRET` as a Worker
secret with at least 32 characters. If it is missing, player submission fails
closed and no payout details are accepted.

Payout creation and status changes deliberately reject the shared
`WBD_CONTENT_ADMIN_TOKEN`: it is logged as `content-cli` and cannot prove
separation of duties. Use distinct, approved signed-in owner identities for
review, creation, approval, and release. The shared token may still be used to
read the payout queue or operate non-cash content.
