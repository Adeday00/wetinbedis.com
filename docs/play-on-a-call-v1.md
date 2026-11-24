# Play on a Call — native room contract v2

**Status: Worker, iPhone and Android source are integrated. Production deployment
and cross-device receipt were not independently verified in the current parity pass.** This is the cross-platform multiplayer path for people who are already
on Discord, WhatsApp, a phone call, or another call. Those apps carry their own
audio/video. Wetin Be Dis coordinates the game between native iPhone and
Android apps. It is not a web game, a Discord Activity, a call integration, or
a replacement for FaceTime SharePlay.

## Product boundaries

- **FaceTime Game** stays the iOS-only SharePlay experience.
- **Play on a Call** is the native iOS/Android room option inside Play with
  Friends. The host shares a room code or native deep link in the call chat.
- **House Party** keeps its in-person language and seat flow, using the same
  cross-platform room protocol so iPhone and Android players can join one table.
- A room has no ads, purchase prompts, League scoring, cash/prize data, email,
  phone number, contacts, call audio, video, or reaction-video upload.
- A host with Full Gist can choose a premium deck for the group; joining guests
  do not need to buy it. A room never decides entitlement itself—the native
  host client does.
- Reaction recordings remain device-local. Before a new round starts, all
  connected people must accept the proposed clip within 45 seconds; any decline,
  departure, or timeout discards it on the recording device.

## Cloudflare design

Each room is one Cloudflare Durable Object (`PlayOnCallRoom`). It owns the
small, temporary lobby snapshot and WebSocket relay for that room. Durable
Object storage lets a hibernated room reconnect without changing teams or
resetting the round; an alarm ends it at its four-hour expiry.

The Worker creates a random four-digit room code and mints a signed, two-minute
WebSocket ticket for the authenticated guest player. The code is for sharing,
not authentication. The ticket is bound
to one room and one player, never written to D1, and is verified before the
Worker forwards the WebSocket upgrade to that room's Durable Object.

The protocol is in `worker/play-on-call-protocol.ts`. It is intentionally
transport-neutral so iOS and Android use the same JSON frames. The relay only
allows lobby changes and a small, role-checked set of game control events. The
native clients must resolve cards from their approved content IDs locally and
must never put clue text, answer text, or the secret card for the current
guesser in a room event payload.

Protocol v2 rejects unknown frame, event and payload fields. Its typed game
events carry only round/checkpoint identifiers, participant identifiers,
indices, timing and decisions; there is no field for a card label, clue,
forbidden word or answer key. The Durable Object de-duplicates event IDs and
binds turn controls to the host-selected active player. Both native clients now
implement guest sessions, REST, strict protocol handling, WebSocket lifecycle,
room UI and the authoritative online game session. The iPhone's legacy
MultipeerConnectivity and Android's legacy DNS-SD/TCP implementations remain in
source but are not the current root routes.

## Mobile API

All REST calls require the existing anonymous guest bearer token. A guest is
created lazily by `POST /api/v1/players/guest`.

| Action | Endpoint | What it returns |
| --- | --- | --- |
| Create a room | `POST /api/v1/call-rooms` | Room code, selected mode, expiry, and a two-minute WebSocket connection ticket |
| Join by code | `POST /api/v1/call-rooms/{code}/join` | The host-selected mode, expiry, and a connection ticket |
| Open room relay | `GET /api/v1/call-rooms/{code}/socket?ticket=…` with WebSocket upgrade | Lobby snapshot followed by room events |

The create body may include `display_name` and one of `hot_seat`,
`everybody_guess`, or `team_battle`. The join body may include a display name;
it cannot change the host's mode. Rooms accept up to 12 people, lock new joins
once a game begins, and expire four hours after creation.

`GET /api/v1/auth/capabilities` now exposes `play_on_call.available`. Native
apps must hide the entry point when that value is false and present a simple
retry state when a ticket expires.

The configured API endpoint is
`https://api.wetinbedis.com/`. The iOS Info.plist and Android build
configuration point at this custom domain. The `workers.dev` address remains
available as a fallback for diagnostics. DNS lookup for the custom host failed
in the 2026-10-16 parity environment, so its current live availability was not
verified in this pass.

## Required Cloudflare production setup

The code and Wrangler configuration declare the `PLAY_ON_CALL_ROOMS` Durable Object
binding and the `v1` SQLite Durable Object migration. The configured Worker
name is `wetin-be-dis-api`; deployment and binding status were not independently
verified in the current parity pass. The current Codex Sites hosting metadata
remains separate so the public marketing site is not replaced.

Before that first deployment:

1. **Previously marked complete; verify before release:** a high-entropy secret
   must be stored only as the Worker secret `WBD_PLAY_ON_CALL_SIGNING_SECRET`
   (for example through `npx wrangler secret put WBD_PLAY_ON_CALL_SIGNING_SECRET`).
   Do not add it to `.openai/hosting.json`, source control, or an app build.
2. **Previously marked complete; verify before release:** the deployment must
   include the `PLAY_ON_CALL_ROOMS` Durable Object binding and apply the `v1`
   migration exactly once. Do not rename the class without an explicit Durable
   Object migration plan.
3. **Partially completed:** the active Cloudflare Free-plan rule named
   `Protect room creation` blocks an IP for 10 seconds after more than five
   `POST /api/v1/call-rooms` requests in 10 seconds. Cloudflare exposes one of
   one rate-limiting rules on this zone, so a separate
   `POST /api/v1/call-rooms/*/join` rule is still required before public
   promotion. Add it after upgrading the zone or implement a separately
   reviewed Worker rate-limiter binding; do not combine the endpoints under a
   low shared threshold because a 12-person room can legitimately join behind
   one home or venue IP. The Worker cannot safely infer an IP-based abuse
   policy on its own.
4. Keep TLS on. The connection URL becomes `wss://` under HTTPS.
5. Verify on a real iPhone and real Android device: create, join, reconnect,
   host leaves, ticket expiry, room expiry, full lobby, and reaction-consent
   paths. Do not use cash League cards or ad UI in this test.

The Worker intentionally fails closed with `503 play_on_call_unavailable` and
reports the feature unavailable when the secret or Durable Object binding is
missing. Confirm the live capability response and room endpoints before
calling the production integration verified.

## Client implementation checklist

- Keep a guest bearer token in secure platform storage; create it only when the
  player opens Play on a Call.
- Create or join the room, then immediately open the returned socket URL.
- Treat the server snapshot as lobby authority; rotate turns/teams only through
  versioned room events and client-side event-id de-duplication.
- Preserve host authority for deck configuration and round progression, but do
  not let a client award currency, League credit, purchase access, or a prize.
- Reconnect with a freshly requested join ticket rather than reusing an expired
  URL. A reconnect is not an affirmative leave.
- Use the same protocol on Android. Neither app needs Discord, WhatsApp, or
  FaceTime SDKs, camera, microphone, WebRTC, TURN, a separate web front end,
  or a call-provider API.

## Privacy and retention

The room stores a pseudonymous guest ID, a chosen short display name, voluntary
team, room code, mode, and temporary game-control state. It is removed by room
expiry (within four hours); the signed ticket expires in two minutes and is not
persisted. The normal guest session has its separately documented 90-day
retention rule. No call content or recording moves through this service.
