# Wetin Be Dis remote-content runbook

The production app fetches an anonymous HTTPS manifest and two immutable, hashed assets. A release changes the complete Party inventory and the active Solo Gist week without an App Store update. The iOS client validates the same product floors as the server, installs all files atomically, and keeps a last-known-good and bundled fallback.

## Owner workflow (recommended)

1. Start from the next-week template or generate a new WAT week from a clean `wbd-site` clone:

   ```sh
   npm run content:build -- --week next --revision 3 --output content/templates/next-release.json
   ```

   Revisions are globally increasing positive integers. `--week` accepts `current`, `next`, or a WAT Monday in `YYYY-MM-DD` form.

2. Review and edit the release JSON. Party source data lives in `content/party-deck-catalog.json`. Solo candidates live in `content/solo-gist-catalog.json`; only cards marked both `READY` and `family_review: Pass` enter a live build. Every publishable card must also contain seven explicit `option_family_reviews` records—one for the answer and one for each distractor—with the reviewed label, canonical Party category, answer family, and `Pass` status. The builder reads each option’s family from that evidence and never copies the question family onto all distractors. Existing READY cards without this evidence now fail closed and require owner review; do not generate the records mechanically. A live build requires at least 35 READY cards, plans a unique five-card set for each WAT day, and keeps at least three categories in every daily set. Extra READY cards stay available for Quick Play and future weeks. Cards on editorial hold stay in the review catalog until their distractor families are genuinely repaired. The publish and validate endpoints reject a next-week release that reuses any of the immediately previous week’s 35 Today’s 5 questions; a same-week higher-revision correction may retain its pack. Curate at least 35 newly approved questions before the next WAT week.

3. Open `/content-admin` on the deployed site and sign in with the allowlisted Sign in with ChatGPT owner account. Upload or paste the JSON. The optional sponsor controls support only `commercial` or `prizeFunding`, a sponsor name, and optional copy. They never accept a link or action.

4. Select **Validate release**. Check the WAT week, revision, 350 Party cards, and active Solo count. Validation is fail-closed for hashes, schedules, category spelling and floors, option families, daily packs, Bonus Gist inventory, and unknown fields. Every Solo answer choice must also resolve to a Party-card label in the same category, so a Food word cannot be relabelled as Slang in a hand-edited release.

5. Check the confirmation and select **Publish atomically**. The public manifest activates only from Monday 00:00 WAT through the following Monday. A replacement for the same week must use a higher revision; old asset URLs remain immutable for last-known-good recovery.

### Before starting the next week

Use the read-only capacity check against the active release. It reports exactly
how many reviewed cards remain after the 35 daily questions from that week are
excluded, and exits non-zero if the next no-repeat week cannot be built:

```sh
npm run content:capacity -- \
  --previous-release content/releases/2026-W40-r3.json
```

The current W40 catalog has 36 approved cards. After W40's 35 daily cards are
excluded, only one reviewed card remains, so W41 requires **34** newly approved
Solo cards (or a deliberate product decision to change the daily cadence). Do
not downgrade the freshness check to hide this capacity gap.

### Candidate bank, not a back door to production

`content/drafts/2026-W41-solo-gist-candidates.json` contains 35 new, owner-review
candidates. It is deliberately separate from the live owner catalog, and every
one remains `EDITORIAL HOLD`; it cannot increase release capacity or be
published by accident. The check below verifies the mechanical promises that
can be proven from source data: seven unique labels, three non-leaking clues,
and answer/distractor labels that all exist in the Party deck under the same
category.

```sh
npm run content:candidates:check
```

The check cannot prove that a family feels fair to a real player. Review each
candidate for cultural tone, clue accuracy and genuinely comparable options;
then deliberately move only accepted cards into `solo-gist-catalog.json` with
`family_review: Pass` and `final_qc: READY`. Re-run the capacity check before
building W41.

Use the promotion helper only after that review. It validates every requested
card before making one local catalog update, never deletes a candidate, and
**never publishes** a release:

```sh
npm run content:candidates:promote -- --approve SG-053,SG-054 --dry-run true
```

After the dry run looks right, repeat with `--dry-run false` to update the
local catalog. The command only accepts explicit IDs. Do not promote a whole bank by default:
the player-facing quality decision belongs to the owner/cultural reviewer, not
to a script or a card-count target.

### Social trends are research only

TikTok, Instagram, Facebook, and X can help a curator discover a topic, but
they never feed a card or release automatically. Keep no post URL, handle,
caption, comment, screenshot, or copied wording in the repository. Record an
abstract topic and independently checked facts in the editorial-only trend
inbox, then write a wholly original candidate through the normal family-review
flow. See [SocialTrendIntake.md](../docs/SocialTrendIntake.md) and validate an
inbox with `npm run content:trends:check`.

Historical examples retained for reference are:

- `content/releases/2026-W35-r1.json` — initial 26-card Solo release and all 350 Party cards. It is a historical asset only and cannot be republished under the current 35-card weekly rule.
- `content/templates/2026-W36-r2.json` — an earlier 26-card template kept only as a format reference. Generate a fresh template before publishing.
- `content/solo-gist-catalog.json` — the owner review catalog. READY cards with a passed family review flow into the active asset; held cards do not.

Player-facing explanations use natural answer/clue copy and must not mention internal review states.

## Sponsor flags for generated releases

The builder can include the same non-clickable sponsor inventory exposed in the browser console:

```sh
npm run content:build -- \
  --week next \
  --revision 3 \
  --output content/templates/next-release.json \
  --sponsor-kind prizeFunding \
  --sponsor-name "Sponsor name" \
  --sponsor-message "Supporting this week's prizes."
```

Omit all sponsor flags for no placement. Expired content may remain playable offline, but its sponsor copy is cleared on-device at expiry even when refresh returns 304 or fails.

## Optional secret CLI

The browser console does not need a bearer secret. Automation may validate or publish with a secret stored only in the shell/deployment environment:

```sh
export WBD_CONTENT_ADMIN_BASE_URL="https://your-production-site.example"
export WBD_CONTENT_ADMIN_TOKEN="set-this-in-the-host-environment-too"
npm run content:validate -- --file content/releases/2026-W35-r1.json
npm run content:publish -- --file content/releases/2026-W35-r1.json
```

The CLI never prints the token or release body. Do not commit `.env` files or paste the token into browser JavaScript.

## Read-only public status check

After publishing, use this command from a cron job or release checklist to
confirm that the public manifest is actually active **at the time of the
check**. It rejects malformed, expired, future-dated, and wrong-release
manifests with a non-zero exit code. It does not authenticate, edit content,
or publish anything. `--expected-release` makes a mismatch fail with a
non-zero exit code.

```sh
npm run content:status -- \
  --base-url https://your-production-site.example \
  --expected-release wbd-2026-w40-r3
```

Set `WBD_CONTENT_PUBLIC_BASE_URL` in a scheduler instead of putting the URL in
the command. A `no_active_content_release` result is a failed activation, not
a signal to silently fall back or re-publish an old release.

## Deployment checklist

- Apply D1 migrations `0000` through `0005` before the first publish. Migration `0003` pins each attempt to a private-pack hash; `0004` records the explicit practice-versus-cash delivery protocol and the server-owned card-issue audit trail needed by a later cash route; `0005` adds encrypted, opt-in-only remote-notification device registrations.
- Set `WBD_CONTENT_ADMIN_USER_IDS` and/or `WBD_CONTENT_ADMIN_EMAILS` to the owner allowlist. Keep `WBD_CONTENT_ADMIN_TOKEN` unset unless CLI automation is required.
- Confirm `/app-ads.txt` serves the checked-in Google publisher authorization.
- Publish the initial release from `/content-admin` after migration, then confirm `/api/v1/content/manifest` returns it during its WAT schedule.
- For rollback, rebuild a replacement from the current reviewed catalog, give it a new higher revision/release ID for the same active week, validate, and publish. Do not mutate an old immutable asset. Historical 26-card seed assets remain readable for recovery but cannot be republished: new weekly releases require 35 unique reviewed cards.

## Cash-competition isolation

Public Party and Solo assets contain their answers, so no public card may be reused in a cash League pack. Competition readiness, attempt creation, and submission compare normalized source IDs, correct-answer labels, clue/card fingerprints against the bundled public baseline and all published/superseded remote assets. A collision fails closed without echoing private answer, option, or clue text. Distractor-label reuse alone does not block an otherwise private card.

Public manifest/assets contain no League pack or League key. Keep draft/candidate prize packs outside the public release JSON.

Cash attempts are deliberately unavailable until phone verification, device attestation, and trusted timing are all implemented. Current API competition payloads are labeled `practice`, expose no active prize places, and mark client timing untrusted. Practice results may appear in a practice ranking; a prize ranking accepts only explicitly integrity-passed attempts. Do not change these gates just to make a giveaway appear live.

### Prize-mode threat model (required before enabling cash)

The current practice start response returns the whole 12-card pack, so an early player could relay or research later answers. `CASH_PRIZE_ATTEMPTS_AVAILABLE` must remain server-owned and `false` until the launch design includes all of the following, with adversarial tests and operations monitoring:

- the hard-gated sequential server-issuance foundation instead of returning all answers/clues/options at start, plus attested device state and trusted server timing before it is enabled;
- a randomized per-player subset drawn from a substantially larger private, isolated bank;
- a short synchronized competition window, rate/relay anomaly monitoring, and a documented human review/void procedure;
- real phone verification, replay-resistant device attestation, and a trusted timing source that does not rank client-provided milliseconds.

The attempt pack hash only prevents the server pack/rules/key from mutating after start. It does not solve collusion, relaying, research, device integrity, or client-clock manipulation by itself.
