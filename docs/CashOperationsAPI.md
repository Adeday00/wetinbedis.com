# Cash Operations API

All endpoints below are owner-only. They require the existing content-admin authorization and same-origin protection for signed-in owner requests. They are preparation and audit tools; they do not enable cash mode.

## Review queue

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

Allowed decisions are `queued`, `in_review`, `cleared`, and `voided`. Every decision requires a note and is written to the attempt plus the review record.

## Payout records

`GET /api/v1/admin/cash/payouts?competition_id=...`

Returns payout records and their status audit metadata. Bank details are intentionally absent.

`POST /api/v1/admin/cash/payouts`

Creates a pending payout only when the attempt is confirmed, the review is cleared, and the amount matches the published prize configuration.

`POST /api/v1/admin/cash/payouts/{payout_id}/status`

Body:

```json
{
  "status": "approved",
  "note": "Second operator approved the verified winner."
}
```

Allowed states are `pending`, `approved`, `sent`, `failed`, and `cancelled`. `sent` requires a provider transfer reference. Approval and release require different authorized operators so a single account cannot silently approve and release its own payout.

The operator should collect payout details only after the final review, through a separate restricted process, then record the transfer reference here—not the bank account number.
