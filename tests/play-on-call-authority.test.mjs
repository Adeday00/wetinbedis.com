import assert from "node:assert/strict";
import test from "node:test";
import {
  reactionResolutionIsValid,
  reactionRosterIsValid,
  reservePlayOnCallEventID,
  turnControlIsAllowed,
} from "../worker/play-on-call-authority.ts";

const hostID = "11111111-2222-4333-8444-555555555555";
const guestID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("room event IDs cannot be replayed or evicted past the safety limit", () => {
  assert.deepEqual(reservePlayOnCallEventID([], "event_123"), {
    accepted: true,
    next: ["event_123"],
  });
  assert.deepEqual(reservePlayOnCallEventID(["event_123"], "event_123"), {
    accepted: false,
    code: "duplicate_event",
  });
  assert.deepEqual(reservePlayOnCallEventID(["one", "two"], "three", 2), {
    accepted: false,
    code: "room_event_limit_reached",
  });
});

test("turn controls stay bound to the host-selected active player and round", () => {
  const authority = { roundID: "round_123", turnPlayerID: guestID };
  assert.equal(turnControlIsAllowed(authority, "round_123", guestID), true);
  assert.equal(turnControlIsAllowed(authority, "round_123", hostID), false);
  assert.equal(turnControlIsAllowed(authority, "round_999", guestID), false);
  assert.equal(turnControlIsAllowed(undefined, "round_123", guestID), false);
});

test("reaction checkpoints require everyone and unanimous keep consent", () => {
  assert.equal(reactionRosterIsValid([hostID, guestID], hostID, [guestID, hostID]), true);
  assert.equal(reactionRosterIsValid([hostID, guestID], hostID, [hostID]), false);
  assert.equal(reactionRosterIsValid([hostID, guestID], hostID, [hostID, hostID]), false);

  const authority = { checkpointID: "checkpoint_123", requiredPlayerIDs: [hostID, guestID] };
  assert.equal(reactionResolutionIsValid(authority, "checkpoint_123", true, [guestID, hostID]), true);
  assert.equal(reactionResolutionIsValid(authority, "checkpoint_123", true, [hostID]), false);
  assert.equal(reactionResolutionIsValid(authority, "checkpoint_123", false, [hostID]), true);
  assert.equal(reactionResolutionIsValid(authority, "wrong", false, []), false);
});
