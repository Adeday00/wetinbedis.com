# Wetin Be Dis Competition API v1

This is the shared contract for iOS and Android competition play. The marketing
site remains independent; mobile endpoints live under `/api/v1`.

## Identity

- `POST /api/v1/players/guest` creates a server-owned player and returns a
  256-bit opaque bearer token once. Only its SHA-256 hash is stored.
- `GET /api/v1/me` is the authority for guest, phone-verified, and eligibility
  state. Clients must not persist or invent a verified flag.
- Existing party play does not require an account. Mobile clients create a guest
  lazily when Solo or League is opened.
- Phone start/verify fail closed with `503 phone_verification_unavailable` until
  a production SMS provider, secrets, rate limits, and abuse controls are added.
  There is no HTTP-exposed development OTP.

## Remote notification registration

- `PUT /api/v1/me/notification-devices` accepts an authenticated player’s APNs
  or FCM token plus three explicit booleans: `league_updates_enabled`,
  `friend_invites_enabled`, and `offers_enabled`.
- The API permits only `ios` and `android` platforms, validates token shape,
  stores a one-way token hash plus ciphertext, and never returns the token.
- Sending all three booleans as `false` deletes that player’s registration for
  the supplied token. It is an opt-out, not a dormant marketing profile.
- The endpoint returns `delivery: "registration_only"`. No remote campaign or
  transactional sender is live until APNs/FCM credentials, a least-privilege
  delivery job, invalid-token handling, and the deployment checklist in
  `docs/RemoteNotificationLaunchPlan.md` are complete.
- If `WBD_PUSH_TOKEN_ENCRYPTION_SECRET` is unavailable, registration fails
  closed with `503 push_registration_unavailable`; the app retains only the
  player’s device-local preference.

## Weekly competition flow

1. `GET /api/v1/competitions/current`
2. `POST /api/v1/competitions/{competition_id}/attempts`
3. Play the returned immutable 12-card pack. The response never contains answer
   keys, answer-family metadata, editorial notes, or sources.
4. `POST /api/v1/attempts/{attempt_id}/submit` with the bearer token plus the
   one-time `X-WBD-Attempt-Token`.
5. `GET /api/v1/competitions/{competition_id}/leaderboard`
6. If needed, `POST /api/v1/attempts/{attempt_id}/challenges` for human review.

The database has a unique `(competition_id, player_id)` constraint, so two
simultaneous requests cannot create a second prize-eligible attempt.

## Submission body

```json
{
  "answers": [
    {
      "card_id": "card-id",
      "position": 1,
      "selected_option_id": "option-id-or-null",
      "response_ms": 932
    }
  ]
}
```

An unanswered card uses `selected_option_id: null` and the full per-card limit.
The server rejects unknown cards, displaced positions, duplicate answers,
unknown options, and times outside the allowed envelope. It recomputes every
correct/incorrect result from its private answer key; a client cannot mark a
miss as correct.

## Ranking

The scoring version is `accuracy-time-v1`:

1. Correct answers, descending.
2. Adjusted total milliseconds, ascending.
3. Hard-card milliseconds, ascending.

Therefore, if 1,000 players score 12/12, lower accepted time decides the order.
Exact matches across all three fields share the same `RANK()` position. The
published prize rule is `share_affected_place_pool`; payout calculation remains
a reviewed operation rather than an automatic transfer.

All newly submitted scores are provisional. Cash readiness still requires
Apple App Attest, Google Play Integrity, timing-envelope calibration, anomaly
review, and an appeal window. Client timing by itself is not payout-safe.

## Editorial gate

A pack cannot start unless it has the exact configured number of approved,
non-voided cards. Each card currently requires:

- three clues;
- seven unique options (one answer plus six distractors);
- every option in the same category as the answer;
- every option in the same answer family as the answer;
- the private correct option present exactly once;
- no direct answer-label leak in a clue;
- immutable content, pack, scoring, and rules versions.

This is the machine gate. Editorial/source review is still required for nuance,
current events, regional usage, and disputes.

## Cash launch gates

The API deliberately prevents cash entry until the player is phone verified,
eligible, and has accepted the exact competition rules version. Production
enablement also requires official rules, regulator/legal clearance, privacy
updates, a phone provider, device attestation, operational review tooling, and
an approved public deployment.
