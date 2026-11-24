# League dashboard design QA — 2026-10-12

Implemented the selected Round First direction, with the requested green banner/leaderboard switches and simplified round setup.

## Evidence

- Reference: option 2 generated image, exec-f32030d7-756b-4501-a9a1-ca8c8447667e.png.
- Production Safari capture: /tmp/wbd-round-first-final.png.
- Reference and rendered screenshot inspected together in one comparison output.
- Both show no active round and the same three-player completed leaderboard.
- Viewports differ: reference 1487×1058; Safari 1920×1000 including browser chrome. This is a structural comparison, not a pixel-perfect certification.

## Verified

- Flat Round / Player display / Announcements tabs, no oversized nested outer cards.
- Latest completed round appears immediately with actual ranks, names, scores, and times.
- Player display shows accessible green switches for banner and leaderboard.
- No hide date is rendered unless automatic hiding is explicitly enabled.
- Setup has a compact Cancel button, paired times, three aligned prizes, and collapsed advanced fields.
- Default round name and NGN 500 / 300 / 200 visible in production.
- Technical session ID generated when omitted; blank pack version preserves the provisioned reviewed pack.
- Fixed duplicate NGN-to-minor-unit conversion in the launch payload.
- TypeScript check, build and all 89 tests passed; deployment 76c17977-aae9-4ac2-af0e-6231c32d9604 succeeded.

## Intentional differences and limits

- Existing production sidebar, header links and brand logo retained; reference decorative calendar omitted.
- Time column retained because adjusted time determines tied rankings.
- Launch, notification sending, winner approval and payments were not exercised by the agent against production.
- Narrow layouts have single-column form rules but were not visually verified on a physical phone.
- Existing sidebar logo overlaps its text; outside this scoped League content update and still requires separate cleanup.
