# Wetin Be Dis remote-content runbook

The production app fetches an anonymous HTTPS manifest and two immutable, hashed assets. A release changes the complete Party inventory and the active Solo Gist week without an App Store update. The iOS client validates the same product floors as the server, installs all files atomically, and keeps a last-known-good and bundled fallback.

## Owner workflow (recommended)

1. Start from the next-week template or generate a new WAT week from a clean `wbd-site` clone:

   ```sh
   npm run content:build -- --week next --revision 3 --output content/templates/next-release.json
   ```

   Revisions are globally increasing positive integers. `--week` accepts `current`, `next`, or a WAT Monday in `YYYY-MM-DD` form.

2. Review and edit the release JSON. Party source data lives in `content/party-deck-catalog.json`. Solo candidates live in `content/solo-gist-catalog.json`; only cards marked both `READY` and `family_review: Pass` enter a live build. The 16 `EDITORIAL HOLD` cards stay in the review catalog until their mixed distractor families are genuinely repaired.

3. Open `/content-admin` on the deployed site and sign in with the allowlisted Sign in with ChatGPT owner account. Upload or paste the JSON. The optional sponsor controls support only `commercial` or `prizeFunding`, a sponsor name, and optional copy. They never accept a link or action.

4. Select **Validate release**. Check the WAT week, revision, 350 Party cards, and active Solo count. Validation is fail-closed for hashes, schedules, category spelling and floors, option families, daily packs, Bonus Gist inventory, and unknown fields.

5. Check the confirmation and select **Publish atomically**. The public manifest activates only from Monday 00:00 WAT through the following Monday. A replacement for the same week must use a higher revision; old asset URLs remain immutable for last-known-good recovery.

Current deployment inputs are:

- `content/releases/2026-W35-r1.json` — initial 26-card READY Solo release and all 350 Party cards.
- `content/templates/2026-W36-r2.json` — next-week owner template.
- `content/solo-gist-catalog.json` — all 42 reviewed candidates (26 READY, 16 HOLD); HOLD cards are not copied into either active asset.

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

## Deployment checklist

- Apply D1 migrations `0000` through `0003` before the first publish. Migration `0003` pins each attempt to a private-pack hash.
- Set `WBD_CONTENT_ADMIN_USER_IDS` and/or `WBD_CONTENT_ADMIN_EMAILS` to the owner allowlist. Keep `WBD_CONTENT_ADMIN_TOKEN` unset unless CLI automation is required.
- Confirm `/app-ads.txt` serves the checked-in Google publisher authorization.
- Publish the initial release from `/content-admin` after migration, then confirm `/api/v1/content/manifest` returns it during its WAT schedule.
- For rollback, repair the prior JSON, give it a new higher revision/release ID for the same active week, validate, and publish. Do not mutate an old immutable asset.

## Cash-competition isolation

Public Party and Solo assets contain their answers, so no public card may be reused in a cash League pack. Competition readiness, attempt creation, and submission compare normalized source IDs, correct-answer labels, clue/card fingerprints against the bundled public baseline and all published/superseded remote assets. A collision fails closed without echoing private answer, option, or clue text. Distractor-label reuse alone does not block an otherwise private card.

Public manifest/assets contain no League pack or League key. Keep draft/candidate prize packs outside the public release JSON.

Cash attempts are deliberately unavailable until phone verification, device attestation, and trusted timing are all implemented. Current API competition payloads are labeled `practice`, expose no active prize places, and mark client timing untrusted. Practice results may appear in a practice ranking; a prize ranking accepts only explicitly integrity-passed attempts. Do not change these gates just to make a giveaway appear live.

### Prize-mode threat model (required before enabling cash)

The current practice start response returns the whole 12-card pack, so an early player could relay or research later answers. `CASH_PRIZE_ATTEMPTS_AVAILABLE` must remain server-owned and `false` until the launch design includes all of the following, with adversarial tests and operations monitoring:

- sequential server issuance instead of returning all answers/clues/options at start, tied to attested device state and trusted server timing;
- a randomized per-player subset drawn from a substantially larger private, isolated bank;
- a short synchronized competition window, rate/relay anomaly monitoring, and a documented human review/void procedure;
- real phone verification, replay-resistant device attestation, and a trusted timing source that does not rank client-provided milliseconds.

The attempt pack hash only prevents the server pack/rules/key from mutating after start. It does not solve collusion, relaying, research, device integrity, or client-clock manipulation by itself.
