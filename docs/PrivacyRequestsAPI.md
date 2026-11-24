# Privacy request operations

These endpoints provide a controlled record for access, correction, and
deletion requests. They do not bypass active prize, fraud, dispute, security,
or legal/accounting holds, and they never carry identity documents, raw phone
numbers, bank details, or payout-account information.

## Player requests

`POST /api/v1/me/privacy-requests`

An authenticated player may create one open request of each type:

```json
{
  "type": "deletion",
  "statement": "Please review deletion of my profile data after any active League review is complete."
}
```

Allowed types are `access`, `correction`, and `deletion`. A duplicate request
of the same type is rejected while its earlier request is queued or under
review. The statement is limited to 1,200 characters and rejects email
addresses, phone-like number strings, and payment-like number strings. Use the
verified support channel for anything sensitive.

`GET /api/v1/me/privacy-requests` lists only the authenticated player’s own
requests and never exposes internal reviewer notes.

## Restricted operations

`GET /api/v1/admin/privacy/requests?status=queued`

`POST /api/v1/admin/privacy/requests/{request_id}`

```json
{
  "status": "completed",
  "note": "Profile export delivered through the verified support channel. No active legal hold applied."
}
```

An owner may move an open request to `in_review`, `completed`, `denied`, or
`withdrawn`. A non-empty, non-sensitive note is required. Closed requests
cannot be silently reopened; create a new request if circumstances change.

## Retention rule

Before marking a deletion request completed, the operator must check whether
the player is tied to an open competition, score challenge, fraud/security
investigation, payout, tax/accounting record, or legal hold. Delete or
anonymize only data whose applicable retention period has ended, record the
scope of the action in the restricted support system, then complete this
workflow. This competition database must never become the store for KYC or
payout evidence.

The API also rejects `completed` deletion requests while it finds a live
attempt, open score challenge, queued/in-review cash review, or
pending/approved payout for that player. Legal, tax, and already-settled
payout holds remain a restricted-operations check because their evidence must
not be copied into this gameplay database.
