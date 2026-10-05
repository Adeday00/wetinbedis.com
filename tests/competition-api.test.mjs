import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

class TestD1Statement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.query, values);
  }

  async first(columnName) {
    const row = this.database.sqlite.prepare(this.query).get(...this.values);
    if (!row) return null;
    return columnName ? row[columnName] ?? null : row;
  }

  async all() {
    const results = this.database.sqlite.prepare(this.query).all(...this.values);
    return { results, success: true, meta: {} };
  }

  async run() {
    const result = this.database.sqlite.prepare(this.query).run(...this.values);
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class TestD1Database {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
  }

  prepare(query) {
    return new TestD1Statement(this, query);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(query) {
    this.sqlite.exec(query);
    return { results: [], success: true, meta: {} };
  }

  close() {
    this.sqlite.close();
  }
}

class TestPlayOnCallRooms {
  constructor() {
    this.rooms = new Map();
  }

  idFromName(name) {
    return name;
  }

  get(id) {
    return {
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const body = request.method === "GET" ? null : await request.json();
        const existing = this.rooms.get(id);
        if (new URL(request.url).pathname === "/create") {
          if (existing) return Response.json({ error: { code: "room_code_collision" } }, { status: 409 });
          const room = {
            roomCode: body.room_code,
            mode: body.mode,
            expiresAt: Date.now() + 60_000,
          };
          this.rooms.set(id, room);
          return Response.json({ room }, { status: 201 });
        }
        if (new URL(request.url).pathname === "/join") {
          return existing
            ? Response.json({ room: existing })
            : Response.json({ error: { code: "room_unavailable" } }, { status: 410 });
        }
        return Response.json({ error: { code: "unhandled_test_room_route" } }, { status: 404 });
      },
    };
  }
}

async function builtWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function migrate(database) {
  for (const name of [
    "0000_brainy_giant_girl.sql",
    "0001_silly_northstar.sql",
    "0002_nice_shiva.sql",
    "0003_mysterious_smasher.sql",
    "0004_loving_aqueduct.sql",
    "0005_chunky_cardiac.sql",
  ]) {
    const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    database.sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
}

function seedCompetition(database) {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO competitions (
        id, slug, title, status, content_status, rules_version, pack_version,
        scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
        entry_mode, country_code, minimum_age, currency,
        opens_at, closes_at, score_review_closes_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'open', 'published', ?, ?, 'accuracy-time-v1',
        12, 12000, 15000, 'guest', 'NG', 18, 'NGN',
        ?, ?, ?, ?, ?)`,
    )
    .run(
      "competition-week-1",
      "season-1-week-1",
      "Gist League — Week 1",
      "rules-v1",
      "pack-v1",
      now - 60_000,
      now + 60 * 60 * 1000,
      now + 2 * 60 * 60 * 1000,
      now,
      now,
    );

  const cardInsert = database.sqlite.prepare(
    `INSERT INTO competition_cards (
      id, competition_id, source_card_id, position, content_version,
      category, answer_family, clues_json, correct_option_id, difficulty,
      editorial_status, verification_note, source_urls_json,
      reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (?, 'competition-week-1', ?, ?, 'content-v1',
      'Food', 'Nigerian soups', ?, ?, ?, 'approved',
      'Editorially verified for the pilot.', '[]', 'editorial-team', ?, ?, ?)`,
  );
  const optionInsert = database.sqlite.prepare(
    `INSERT INTO competition_card_options (
      card_id, option_id, position, label, category, answer_family
    ) VALUES (?, ?, ?, ?, 'Food', 'Nigerian soups')`,
  );

  for (let position = 1; position <= 12; position += 1) {
    const cardId = `card-${position}`;
    cardInsert.run(
      cardId,
      `source-${position}`,
      position,
      JSON.stringify([
        "Often served warm",
        "Common at celebrations",
        "Made with local ingredients",
      ]),
      `${cardId}-option-1`,
      position >= 10 ? "hard" : "standard",
      now,
      now,
      now,
    );
    for (let option = 1; option <= 7; option += 1) {
      optionInsert.run(
        cardId,
        `${cardId}-option-${option}`,
        option,
        option === 1
          ? `Correct dish ${position}`
          : `Distractor ${position}-${option}`,
      );
    }
  }
}

function seedPrizes(database) {
  const insert = database.sqlite.prepare(
    `INSERT INTO competition_prizes (competition_id, place, amount_minor)
     VALUES ('competition-week-1', ?, ?)`,
  );
  insert.run(1, 10_000_000);
  insert.run(2, 6_000_000);
  insert.run(3, 4_000_000);
}

async function request(worker, database, path, init = {}, envOverrides = {}) {
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      ...envOverrides,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("Play on a Call room API is capability-gated and preserves the host's selected mode", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const firstGuestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const firstGuest = await firstGuestResponse.json();
  const headers = {
    authorization: `Bearer ${firstGuest.session.token}`,
    "content-type": "application/json",
  };

  const unavailable = await request(worker, database, "/api/v1/call-rooms", {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "team_battle" }),
  });
  assert.equal(unavailable.status, 503);

  const rooms = new TestPlayOnCallRooms();
  const environment = {
    PLAY_ON_CALL_ROOMS: rooms,
    WBD_PLAY_ON_CALL_SIGNING_SECRET: "play-on-call-api-test-secret-that-is-at-least-thirty-two-characters",
  };
  const createdResponse = await request(worker, database, "/api/v1/call-rooms", {
    method: "POST",
    headers,
    body: JSON.stringify({ display_name: "  Host   Person ", mode: "team_battle" }),
  }, environment);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.room_code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(created.room.mode, "team_battle");
  assert.match(created.connection.socket_url, new RegExp(`/api/v1/call-rooms/${created.room_code}/socket\\?ticket=`));

  const secondGuestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "android" }),
  });
  const secondGuest = await secondGuestResponse.json();
  const joinedResponse = await request(worker, database, `/api/v1/call-rooms/${created.room_code}/join`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secondGuest.session.token}`,
      "content-type": "application/json",
    },
    // Join should not let a guest reconfigure a room started by the host.
    body: JSON.stringify({ mode: "hot_seat" }),
  }, environment);
  assert.equal(joinedResponse.status, 200);
  const joined = await joinedResponse.json();
  assert.equal(joined.room.mode, "team_battle");
});

test("notification registration encrypts device tokens and deletes them on all-off opt-out", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const encryptionSecret = "notification-test-secret-that-is-at-least-thirty-two-characters";

  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const guest = await guestResponse.json();
  const authHeaders = {
    authorization: `Bearer ${guest.session.token}`,
    "content-type": "application/json",
  };
  const token = "a".repeat(64);
  const unavailableResponse = await request(
    worker,
    database,
    "/api/v1/me/notification-devices",
    {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        platform: "ios",
        token,
        preferences: {
          league_updates_enabled: true,
          friend_invites_enabled: false,
          offers_enabled: false,
        },
      }),
    },
  );
  assert.equal(unavailableResponse.status, 503);
  assert.equal((await unavailableResponse.json()).error.code, "push_registration_unavailable");
  assert.equal(
    database.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_devices").get().count,
    0,
  );

  const enabledResponse = await request(
    worker,
    database,
    "/api/v1/me/notification-devices",
    {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        platform: "ios",
        token,
        preferences: {
          league_updates_enabled: true,
          friend_invites_enabled: false,
          offers_enabled: true,
        },
      }),
    },
    { WBD_PUSH_TOKEN_ENCRYPTION_SECRET: encryptionSecret },
  );
  assert.equal(enabledResponse.status, 200);
  assert.equal((await enabledResponse.json()).registration.delivery, "registration_only");
  const stored = database.sqlite
    .prepare("SELECT token_hash, token_ciphertext, league_updates_enabled, offers_enabled FROM notification_devices")
    .get();
  assert.notEqual(stored.token_hash, token);
  assert.doesNotMatch(stored.token_ciphertext, new RegExp(token));
  assert.equal(stored.league_updates_enabled, 1);
  assert.equal(stored.offers_enabled, 1);

  const optOutResponse = await request(
    worker,
    database,
    "/api/v1/me/notification-devices",
    {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        platform: "ios",
        token,
        preferences: {
          league_updates_enabled: false,
          friend_invites_enabled: false,
          offers_enabled: false,
        },
      }),
    },
    { WBD_PUSH_TOKEN_ENCRYPTION_SECRET: encryptionSecret },
  );
  assert.equal(optOutResponse.status, 200);
  assert.equal((await optOutResponse.json()).registration.status, "removed");
  assert.equal(
    database.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_devices").get().count,
    0,
  );
});

test("a new guest session prunes expired anonymous credentials but preserves review records", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();

  const abandonedResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const abandoned = await abandonedResponse.json();
  database.sqlite
    .prepare("UPDATE player_sessions SET expires_at = ? WHERE player_id = ?")
    .run(Date.now() - 1, abandoned.player.id);

  const retainedPlayerId = "guest-with-review-record";
  const retainedSessionId = "expired-review-session";
  database.sqlite
    .prepare(
      `INSERT INTO players (
        id, public_handle, account_state, eligibility_status, created_at, updated_at
      ) VALUES (?, 'GIST-RETAINED', 'guest', 'guest', ?, ?)`,
    )
    .run(retainedPlayerId, Date.now(), Date.now());
  database.sqlite
    .prepare(
      `INSERT INTO player_sessions (
        id, player_id, token_hash, platform, expires_at, last_seen_at, created_at
      ) VALUES (?, ?, 'retained-expired-token-hash', 'ios', ?, ?, ?)`,
    )
    .run(retainedSessionId, retainedPlayerId, Date.now() - 1, Date.now(), Date.now());
  database.sqlite
    .prepare(
      `INSERT INTO competitions (
        id, slug, title, status, content_status, rules_version, pack_version,
        scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
        entry_mode, country_code, minimum_age, currency,
        opens_at, closes_at, score_review_closes_at, created_at, updated_at
      ) VALUES (
        'retention-competition', 'retention-week', 'Retention test', 'locked', 'published',
        'rules-v1', 'pack-v1', 'accuracy-time-v1', 12, 12000, 15000,
        'guest', 'NG', 18, 'NGN', ?, ?, ?, ?, ?
      )`,
    )
    .run(Date.now() - 2_000, Date.now() - 1_000, Date.now() + 86_400_000, Date.now(), Date.now());
  database.sqlite
    .prepare(
      `INSERT INTO attempts (
        id, competition_id, player_id, attempt_token_hash, rules_version,
        pack_version, scoring_version, started_at, play_deadline_at,
        submit_deadline_at, created_at, updated_at
      ) VALUES (
        'retention-attempt', 'retention-competition', ?, 'retention-attempt-token-hash',
        'rules-v1', 'pack-v1', 'accuracy-time-v1', ?, ?, ?, ?, ?
      )`,
    )
    .run(
      retainedPlayerId,
      Date.now() - 2_000,
      Date.now() - 1_500,
      Date.now() - 1_000,
      Date.now(),
      Date.now(),
    );

  const freshResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  assert.equal(freshResponse.status, 201);
  assert.equal(
    database.sqlite.prepare("SELECT id FROM players WHERE id = ?").get(abandoned.player.id),
    undefined,
  );
  assert.equal(
    database.sqlite.prepare("SELECT id FROM player_sessions WHERE player_id = ?").get(retainedPlayerId),
    undefined,
  );
  assert.equal(
    database.sqlite.prepare("SELECT id FROM players WHERE id = ?").get(retainedPlayerId).id,
    retainedPlayerId,
  );
  assert.equal(
    database.sqlite.prepare("SELECT id FROM attempts WHERE id = 'retention-attempt'").get().id,
    "retention-attempt",
  );
});

test("runs the guarded practice competition flow against the generated schema", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const worker = await builtWorker();

  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios", app_version: "1.0" }),
  });
  assert.equal(guestResponse.status, 201);
  const guest = await guestResponse.json();
  assert.match(guest.session.token, /^wbd_s_/);
  assert.match(guest.player.public_handle, /^GIST-/);

  const authHeaders = { authorization: `Bearer ${guest.session.token}` };
  const meResponse = await request(worker, database, "/api/v1/me", {
    headers: authHeaders,
  });
  assert.equal(meResponse.status, 200);
  assert.equal((await meResponse.json()).player.verification_level, "guest");

  const currentResponse = await request(
    worker,
    database,
    "/api/v1/competitions/current",
  );
  assert.equal(currentResponse.status, 200);
  const current = await currentResponse.json();
  assert.equal(current.competition.question_count, 12);
  assert.equal(current.competition.mode, "practice");
  assert.equal(current.competition.prize_eligible, false);
  assert.deepEqual(current.competition.prize.places, []);
  assert.equal(current.competition.prize.configured_place_count, 0);
  assert.equal(current.competition.status, "preview");
  assert.equal(current.competition.entry.mode, "practice_preview");

  const startResponse = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    { method: "POST", headers: authHeaders },
  );
  assert.equal(startResponse.status, 201);
  const started = await startResponse.json();
  assert.equal(started.attempt.cards.length, 12);
  assert.doesNotMatch(JSON.stringify(started.attempt.cards), /correct_option|answer_family/i);
  assert.match(started.attempt.token, /^wbd_a_/);
  assert.equal(
    database.sqlite
      .prepare("SELECT delivery_protocol FROM attempts WHERE id = ?")
      .get(started.attempt.id).delivery_protocol,
    "practice_batch_v1",
  );

  const duplicateStart = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    { method: "POST", headers: authHeaders },
  );
  assert.equal(duplicateStart.status, 409);
  assert.equal((await duplicateStart.json()).error.code, "attempt_already_used");

  database.sqlite
    .prepare("UPDATE attempts SET started_at = ? WHERE id = ?")
    .run(Date.now() - 3_000, started.attempt.id);

  const answers = Array.from({ length: 12 }, (_, index) => ({
    card_id: `card-${index + 1}`,
    position: index + 1,
    selected_option_id: `card-${index + 1}-option-1`,
    response_ms: 200,
  }));
  const submitResponse = await request(
    worker,
    database,
    `/api/v1/attempts/${started.attempt.id}/submit`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "x-wbd-attempt-token": started.attempt.token,
      },
      body: JSON.stringify({ answers }),
    },
  );
  assert.equal(submitResponse.status, 200);
  const submitted = await submitResponse.json();
  assert.equal(submitted.score.correct_count, 12);
  assert.equal(submitted.score.adjusted_total_ms, 2_400);
  assert.equal(submitted.score.status, "provisional");
  assert.equal(submitted.score.prize_eligible, false);
  assert.equal(submitted.score.timing_trust, "client_reported_untrusted");
  assert.ok(submitted.score.integrity_flags.includes("client_timing_untrusted"));

  const leaderboardResponse = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/leaderboard",
  );
  assert.equal(leaderboardResponse.status, 200);
  const leaderboard = await leaderboardResponse.json();
  assert.equal(leaderboard.leaderboard[0].rank, 1);
  assert.equal(leaderboard.leaderboard[0].correct_count, 12);
  assert.equal(leaderboard.leaderboard[0].public_handle, guest.player.public_handle);
  assert.equal(leaderboard.competition.mode, "practice");

  database.sqlite
    .prepare("UPDATE competitions SET entry_mode = 'phone_verified' WHERE id = 'competition-week-1'")
    .run();
  const cashLeaderboardResponse = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/leaderboard",
  );
  assert.equal(cashLeaderboardResponse.status, 503);
  assert.equal((await cashLeaderboardResponse.json()).error.code, "cash_competition_unavailable");

  const challengeResponse = await request(
    worker,
    database,
    `/api/v1/attempts/${started.attempt.id}/challenges`,
    {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "card_answer",
        card_id: "card-1",
        statement: "I believe the published answer for this card needs a human review.",
      }),
    },
  );
  assert.equal(challengeResponse.status, 201);
  const challenge = await challengeResponse.json();
  assert.equal(challenge.challenge.status, "open");
  assert.equal(challenge.challenge.review, "human");
});

test("an accidental open guest prize row stays unavailable everywhere", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  seedPrizes(database);
  const worker = await builtWorker();
  const current = await request(worker, database, "/api/v1/competitions/current");
  assert.equal(current.status, 503);
  assert.equal((await current.json()).error.code, "cash_competition_unavailable");
  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios", app_version: "1.0" }),
  });
  const guest = await guestResponse.json();
  const response = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    {
      method: "POST",
      headers: { authorization: `Bearer ${guest.session.token}` },
    },
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "cash_competition_unavailable");
  assert.equal(payload.error.details.device_attestation_required, true);
  assert.equal(payload.error.details.trusted_timing_required, true);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);
});

test("the future cash-answer route is hard-off even when called directly", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const worker = await builtWorker();

  const response = await request(
    worker,
    database,
    "/api/v1/attempts/not-a-real-attempt/cash-answer",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected_option_id: null }),
    },
  );
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "cash_competition_unavailable");
  assert.equal(payload.error.details.prize_eligible, false);
});

test("readiness and attempt creation fail closed when a prize card overlaps public content", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  database.sqlite
    .prepare(
      `UPDATE competitions SET entry_mode = 'guest'
       WHERE id = 'competition-week-1'`,
    )
    .run();
  database.sqlite
    .prepare(
      `UPDATE competition_cards SET source_card_id = 'GL-037'
       WHERE id = 'card-1'`,
    )
    .run();
  const worker = await builtWorker();

  const currentResponse = await request(
    worker,
    database,
    "/api/v1/competitions/current",
  );
  assert.equal(currentResponse.status, 409);
  const currentError = await currentResponse.json();
  assert.equal(currentError.error.code, "competition_pack_not_isolated");
  assert.doesNotMatch(JSON.stringify(currentError), /sapa|wahala|owner-reviewed/i);

  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios", app_version: "1.0" }),
  });
  const guest = await guestResponse.json();
  const startResponse = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    {
      method: "POST",
      headers: { authorization: `Bearer ${guest.session.token}` },
    },
  );
  assert.equal(startResponse.status, 409);
  assert.equal((await startResponse.json()).error.code, "competition_pack_not_isolated");
  assert.equal(
    database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempts").get().count,
    0,
  );
});

test("revoked public content remains permanently isolated from private packs", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const now = Date.now();
  database.sqlite.prepare(
    `INSERT INTO content_releases (
      id, revision, schema_version, status, effective_week_wat,
      effective_from_ms, expires_at_ms, minimum_app_version,
      published_by, published_at, created_at
    ) VALUES ('revoked-public-r1', 77, 1, 'revoked', '2026-W01',
      ?, ?, '1.0.0', 'test-owner', ?, ?)`,
  ).run(now - 20_000, now - 10_000, now - 20_000, now - 20_000);
  const revokedPayload = JSON.stringify({
    questions: [{
      id: "REVOKED-PUBLIC-1",
      clues: ["Retired public clue one", "Retired public clue two", "Retired public clue three"],
      correct_option_id: "revoked-option-1",
      options: [{ id: "revoked-option-1", label: "Retired public answer" }],
    }],
  });
  database.sqlite.prepare(
    `INSERT INTO content_assets (
      release_id, kind, content_version, sha256, byte_count,
      item_count, payload_json, created_at
    ) VALUES ('revoked-public-r1', 'solo_gist', 'revoked-v1', ?, ?, 1, ?, ?)`,
  ).run("0".repeat(64), Buffer.byteLength(revokedPayload), revokedPayload, now);
  database.sqlite.prepare(
    "UPDATE competition_cards SET source_card_id = 'REVOKED-PUBLIC-1' WHERE id = 'card-1'",
  ).run();
  const worker = await builtWorker();

  const response = await request(worker, database, "/api/v1/competitions/current");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "competition_pack_not_isolated");
});

test("submission rechecks public isolation after an attempt has started", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  database.sqlite
    .prepare("UPDATE competitions SET entry_mode = 'guest' WHERE id = 'competition-week-1'")
    .run();
  const worker = await builtWorker();

  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios", app_version: "1.0" }),
  });
  const guest = await guestResponse.json();
  const authHeaders = { authorization: `Bearer ${guest.session.token}` };
  const startResponse = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    { method: "POST", headers: authHeaders },
  );
  assert.equal(startResponse.status, 201);
  const started = await startResponse.json();

  database.sqlite
    .prepare("UPDATE competition_cards SET source_card_id = 'SG-002' WHERE id = 'card-1'")
    .run();
  const answers = Array.from({ length: 12 }, (_, index) => ({
    card_id: `card-${index + 1}`,
    position: index + 1,
    selected_option_id: `card-${index + 1}-option-1`,
    response_ms: 200,
  }));
  const submitResponse = await request(
    worker,
    database,
    `/api/v1/attempts/${started.attempt.id}/submit`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "x-wbd-attempt-token": started.attempt.token,
      },
      body: JSON.stringify({ answers }),
    },
  );
  assert.equal(submitResponse.status, 409);
  const error = await submitResponse.json();
  assert.equal(error.error.code, "competition_under_review");
  assert.doesNotMatch(JSON.stringify(error), /sapa|wahala|owner-reviewed/i);
  assert.equal(
    database.sqlite.prepare("SELECT status FROM attempts WHERE id = ?").get(started.attempt.id).status,
    "started",
  );
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempt_answers").get().count, 0);
});

test("submission fails closed when the pinned private pack changes after start", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const worker = await builtWorker();
  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios", app_version: "1.0" }),
  });
  const guest = await guestResponse.json();
  const authHeaders = { authorization: `Bearer ${guest.session.token}` };
  const startResponse = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    { method: "POST", headers: authHeaders },
  );
  assert.equal(startResponse.status, 201);
  const started = await startResponse.json();
  assert.match(
    database.sqlite.prepare("SELECT pack_hash FROM attempts WHERE id = ?").get(started.attempt.id).pack_hash,
    /^[a-f0-9]{64}$/,
  );

  database.sqlite
    .prepare(
      "UPDATE competition_card_options SET label = 'Changed private distractor' WHERE card_id = 'card-1' AND option_id = 'card-1-option-2'",
    )
    .run();
  const answers = Array.from({ length: 12 }, (_, index) => ({
    card_id: `card-${index + 1}`,
    position: index + 1,
    selected_option_id: `card-${index + 1}-option-1`,
    response_ms: 200,
  }));
  const submitResponse = await request(
    worker,
    database,
    `/api/v1/attempts/${started.attempt.id}/submit`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "x-wbd-attempt-token": started.attempt.token,
      },
      body: JSON.stringify({ answers }),
    },
  );
  assert.equal(submitResponse.status, 409);
  assert.equal((await submitResponse.json()).error.code, "competition_under_review");
});
