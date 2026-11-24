import assert from "node:assert/strict";
import test from "node:test";
import { PlayOnCallRoom } from "../worker/play-on-call-room.ts";

class MemoryStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm() {}
}

function request(path, method, { body, headers = {} } = {}) {
  return new Request(`https://room.test${path}`, {
    method,
    headers: { "x-wbd-call-room-proxy": "1", ...headers, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("TV projection Durable Object keeps viewer read-only and enforces expiry", async () => {
  const storage = new MemoryStorage();
  const room = new PlayOnCallRoom({ storage, getWebSockets: () => [], acceptWebSocket() {} }, {});
  const owner = "owner-secret-with-strong-randomness";
  const viewer = "viewer-secret-with-strong-randomness";
  const create = await room.fetch(request("/tv/create", "POST", { body: { owner_token: owner, viewer_token: viewer } }));
  assert.equal(create.status, 201);

  const invalidPublish = await room.fetch(request("/tv/state", "PUT", {
    headers: { "x-wbd-tv-owner-token": viewer },
    body: { phase: "playing", answer: "Jollof", forbidden_words: [] },
  }));
  assert.equal(invalidPublish.status, 403);

  const publish = await room.fetch(request("/tv/state", "PUT", {
    headers: { "x-wbd-tv-owner-token": owner },
    body: {
      phase: "playing", team: "Team 1", round: 1, round_duration: 45,
      seconds_remaining: 30, score: 2, category: "Food", difficulty: "Medium",
      answer: "Jollof Rice", forbidden_words: ["Tomato", "Party", "Pot"],
    },
  }));
  assert.equal(publish.status, 200);

  const read = await room.fetch(request("/tv/state?key=wrong", "GET"));
  assert.equal(read.status, 403);
  const viewerRead = await room.fetch(request(`/tv/state?key=${viewer}`, "GET"));
  assert.equal(viewerRead.status, 200);
  assert.equal((await viewerRead.json()).state.answer, "Jollof Rice");

  const session = storage.values.get("project_to_tv_state_v1");
  session.expiresAt = Date.now() - 1;
  await storage.put("project_to_tv_state_v1", session);
  const expired = await room.fetch(request(`/tv/state?key=${viewer}`, "GET"));
  assert.equal(expired.status, 410);
});
