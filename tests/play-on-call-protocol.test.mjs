import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlayOnCallRoomCode,
  normalizePlayOnCallRoomCode,
  parsePlayOnCallClientFrame,
} from "../worker/play-on-call-protocol.ts";
import {
  signPlayOnCallTicket,
  verifyPlayOnCallTicket,
} from "../worker/api/crypto.ts";

const signingSecret = "play-on-call-test-secret-that-is-at-least-thirty-two-characters";
const ticket = {
  roomCode: "ABCD2345",
  playerID: "11111111-2222-4333-8444-555555555555",
  displayName: "Seyi",
  expiresAt: 2_000_000_000_000,
};

test("Play on a Call room codes are friendly, fixed length, and normalized", () => {
  const code = createPlayOnCallRoomCode(() => 0);
  assert.equal(code, "AAAAAAAA");
  assert.equal(normalizePlayOnCallRoomCode(" wbd-abcd 2345 "), "ABCD2345");
  assert.equal(normalizePlayOnCallRoomCode("ABCD-2345"), null);
  assert.equal(normalizePlayOnCallRoomCode("ABCD1234"), null);
});

test("Play on a Call tickets are signed, room-bound and short-lived", async () => {
  const signed = await signPlayOnCallTicket(ticket, signingSecret);
  assert.deepEqual(await verifyPlayOnCallTicket(signed, signingSecret, ticket.expiresAt - 1), ticket);
  assert.equal(await verifyPlayOnCallTicket(`${signed}x`, signingSecret, ticket.expiresAt - 1), null);
  assert.equal(await verifyPlayOnCallTicket(signed, signingSecret, ticket.expiresAt), null);
  assert.equal(await verifyPlayOnCallTicket(signed, "wrong-secret-that-is-still-long-enough-to-pass-the-length-check", ticket.expiresAt - 1), null);
});

test("Play on a Call accepts only bounded, known client event shapes", () => {
  assert.deepEqual(
    parsePlayOnCallClientFrame(JSON.stringify({
      type: "event",
      event_id: "roundStart_123",
      event: {
        type: "game_event",
        event_type: "round_start",
        payload: {
          round_id: "round_123",
          round_number: 1,
          turn_player_id: "11111111-2222-4333-8444-555555555555",
          deadline_ms: 2_000_000_000_000,
        },
      },
    })),
    {
      type: "event",
      event_id: "roundStart_123",
      event: {
        type: "game_event",
        event_type: "round_start",
        payload: {
          round_id: "round_123",
          round_number: 1,
          turn_player_id: "11111111-2222-4333-8444-555555555555",
          deadline_ms: 2_000_000_000_000,
        },
      },
    },
  );
  assert.equal(
    parsePlayOnCallClientFrame(JSON.stringify({
      type: "event",
      event_id: "tiny",
      event: { type: "leave_room" },
    })),
    null,
  );
  assert.equal(
    parsePlayOnCallClientFrame("x".repeat(9_000)),
    null,
  );
  assert.equal(
    parsePlayOnCallClientFrame(JSON.stringify({
      type: "event",
      event_id: "cardAction_123",
      event: {
        type: "game_event",
        event_type: "card_action",
        payload: {
          round_id: "round_123",
          card_index: 2,
          action: "correct",
          answer_key: "must-never-travel",
        },
      },
    })),
    null,
  );
  assert.equal(
    parsePlayOnCallClientFrame(JSON.stringify({
      type: "event",
      event_id: "unknownEvent_123",
      event: { type: "game_event", event_type: "send_whole_card", payload: {} },
    })),
    null,
  );
});
