# Remote operations release-readiness report

## Implemented

- Versioned `GET /api/v1/app-config` with strict schema validation, safe defaults, ETag support, bounded cache TTL, and monotonic revisions.
- Authenticated owner workflows for app-config draft, review, publish, rollback, revoke, and emergency disable, plus content-release rollback/revoke. Every mutation records actor, reason, timestamp, action, and revision/release in D1.
- Existing content-release validation remains authoritative for reviewed cards, hashes, schedules, category integrity, Today’s 5 freshness, and immutable asset URLs.
- iOS and Android consume the same app-config contract, persist a validated last-known-good snapshot, refresh at launch/foreground boundaries, and reject malformed responses. A cash-enabled response still cannot open a cash attempt unless the Worker independently verifies every launch gate.
- Home League placement is remotely shown/removed on both platforms and always displays practice/no-cash copy while cash gates are false.
- Existing League server controls remain fail-closed: server time, attempt tokens, fixed/private pack snapshots, sequential cash protocol, replay protection, server scoring, integrity flags, review states, privacy-safe leaderboard output, and evidence-gated cash capability.
- Cash operations now have restricted review and payout records with immutable payout-status audit entries; no bank details are stored in the competition database.
- iOS App Attest and Android Play Integrity client foundations are present, but production provider verification remains a launch gate.
- Restricted cash review and payout endpoints are available for owner operations; they require a cleared attempt, published prize amount, audit notes, and separate approval/release actors.

## Verification

- Worker production build: passed.
- Worker TypeScript typecheck: passed.
- Worker lint: passed.
- Backend, content, competition, and app-config API tests: 61 passed.
- Drizzle migration consistency check: passed.
- Swift remote-config source typecheck: passed.
- Android debug Kotlin compile: passed with the installed Java 17 and Android SDK.
- Android debug unit tests: passed.
- Android debug lint: passed.
- iOS generic-device build with signing disabled: passed. The build emitted existing Swift concurrency/deprecation warnings but no errors.
- Production Worker deployment is now live as of 2026-10-07. The live health
  endpoint reports the database configured, and the production D1 contains the
  Google Play purchase, entitlement, and reviewer-access tables. A real
  Play-installed purchase and physical-device validation remain outstanding.

## Cash gates still blocked

Cash prizes remain unavailable because no complete evidence record exists for every required launch gate, and the remote cash switch remains off. The server requires independently completed legal/jurisdiction review for each enabled country, adult eligibility, identity/sanctions/fraud and payout verification, App Attest, Play Integrity, abuse controls, server timing/scoring, winner review, appeals, privacy/retention/deletion operations, support, confirmed prize funding, and tested cancellation messaging.

## Owner practice-League release

1. Validate and publish the reviewed content release.
2. Submit app config as draft, move it to review, then publish it with `mode: "practice"`, a WAT schedule, `cash_enabled: false`, and the reviewed release ID.
3. Confirm `GET /api/v1/app-config` returns the new revision and `GET /api/v1/competitions/current` presents practice/no-cash behavior.
4. Monitor attempt integrity and review queues; use emergency disable if the event must be paused.

Physical-device parity, a real Play-installed purchase, and the legal/payment/
App Store/Play Store launch gates remain outstanding.
