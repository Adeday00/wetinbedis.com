import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlayOnCallRoomCode,
  isRoomJoinable,
  newPlayOnCallRoom,
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

test("Play on a Call room codes are short for new rooms and preserve legacy joins", () => {
  const code = createPlayOnCallRoomCode(() => 0);
  assert.equal(code, "1000");
  assert.equal(createPlayOnCallRoomCode(() => 0.999999), "9999");
  assert.equal(normalizePlayOnCallRoomCode(" 4827 "), "4827");
  assert.equal(normalizePlayOnCallRoomCode(" wbd-abcd 23 "), "ABCD23");
  assert.equal(normalizePlayOnCallRoomCode(" wbd-abcd 2345 "), "ABCD2345");
  assert.equal(normalizePlayOnCallRoomCode("0123"), "0123");
  assert.equal(normalizePlayOnCallRoomCode("123"), null);
  assert.equal(normalizePlayOnCallRoomCode("ABCD-2345"), null);
  assert.equal(normalizePlayOnCallRoomCode("ABCD1234"), null);
});

test("Play on a Call closes new admission once a room starts but leaves reconnect policy to the room", () => {
  const room = newPlayOnCallRoom(
    "ABCD2345",
    { playerID: ticket.playerID, displayName: "Seyi", joinedAt: 1, team: null },
    "hot_seat",
    1,
  );
  assert.equal(isRoomJoinable(room, 2), true);
  room.phase = "playing";
  assert.equal(isRoomJoinable(room, 2), false);
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
          start_card_index: 0,
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
          start_card_index: 0,
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
    parsePlayOnCallClientFrame("x".repeat(70_000)),
    null,
  );
  const configured = parsePlayOnCallClientFrame(JSON.stringify({
    type: "event",
    event_id: "configure_123",
    event: {
      type: "game_event",
      event_type: "configure_game",
      payload: {
        mode: "hot_seat",
        round_seconds: 60,
        turns_each: 2,
        deck_ids: ["FOOD-001", "SLANG-002"],
        uses_companion_phone: true,
        full_gist_enabled: false,
      },
    },
  }));
  assert.equal(configured?.event.event_type, "configure_game");
  assert.deepEqual(
    parsePlayOnCallClientFrame(JSON.stringify({
      type: "event",
      event_id: "assignTeam_123",
      event: {
        type: "assign_team",
        player_id: "11111111-2222-4333-8444-555555555555",
        team: 1,
      },
    }))?.event,
    {
      type: "assign_team",
      player_id: "11111111-2222-4333-8444-555555555555",
      team: 1,
    },
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
