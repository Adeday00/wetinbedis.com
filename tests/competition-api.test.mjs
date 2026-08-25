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

async function request(worker, database, path, init = {}) {
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

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
