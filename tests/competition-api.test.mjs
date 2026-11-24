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
    this.tvDisplays = new Map();
  }

  idFromName(name) {
    return name;
  }

  get(id) {
    return {
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const body = request.method === "GET" || request.method === "DELETE" ? null : await request.json();
        const existing = this.rooms.get(id);
        const path = new URL(request.url).pathname;
        if (path === "/tv/rate-limit") {
          return Response.json({ allowed: true, retry_after_seconds: 60 });
        }
        if (path === "/tv/create") {
          const sessionID = String(id).split(":").at(-1);
          const hash = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          this.tvDisplays.set(sessionID, {
            ownerHash: await hash(body.owner_token), viewerHash: await hash(body.viewer_token),
            expiresAt: Date.now() + 60_000,
            state: { phase: "waiting", team: "", round: 0, roundDuration: 60, secondsRemaining: 0, score: 0, category: null, difficulty: null, answer: null, forbiddenWords: [], updatedAt: Date.now() },
          });
          return Response.json({ expires_at: Date.now() + 60_000 }, { status: 201 });
        }
        if (path === "/tv/state") {
          const sessionID = String(id).split(":").at(-1);
          const tv = this.tvDisplays.get(sessionID);
          if (!tv || tv.expiresAt <= Date.now()) return Response.json({ error: { code: "tv_display_expired" } }, { status: 410 });
          const hash = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          if (request.method === "GET") {
            return await hash(new URL(request.url).searchParams.get("key") ?? "") === tv.viewerHash
              ? Response.json({ state: tv.state, expires_at: tv.expiresAt })
              : Response.json({ error: { code: "tv_display_forbidden" } }, { status: 403 });
          }
          const authorized = await hash(request.headers.get("x-wbd-tv-owner-token") ?? "") === tv.ownerHash;
          if (!authorized) return Response.json({ error: { code: "tv_display_forbidden" } }, { status: 403 });
          if (request.method === "DELETE") { this.tvDisplays.delete(sessionID); return Response.json({ ok: true }); }
          if (typeof body.answer !== "string" || body.answer.length > 100 || !Array.isArray(body.forbidden_words)) {
            return Response.json({ error: { code: "invalid_tv_state" } }, { status: 400 });
          }
          tv.state = {
            phase: body.phase, team: body.team, round: body.round, roundDuration: body.round_duration,
            secondsRemaining: body.seconds_remaining, score: body.score,
            category: body.category, difficulty: body.difficulty, answer: body.answer,
            forbiddenWords: body.forbidden_words, updatedAt: Date.now(),
          };
          return Response.json({ ok: true });
        }
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
    "0007_wakeful_toxin.sql",
    "0008_content_release_audit.sql",
    "0009_cash_operations.sql",
    "0010_party_deck_editor.sql",
    "0011_google_play_entitlements.sql",
    "0012_google_review_access.sql",
    "0013_firebase_league_profiles.sql",
    "0014_username_registry.sql",
    "0015_apple_app_attest.sql",
    "0016_player_eligibility_reviews.sql",
    "0017_privacy_requests.sql",
    "0018_cash_launch_gates.sql",
    "0019_competition_eligible_countries.sql",
    "0020_competition_eligibility_policy_audit.sql",
    "0021_competition_payouts_ngn.sql",
    "0022_cash_launch_gate_audit.sql",
    "0023_payout_details_vault.sql",
    "0024_rehearsal_payout_previews.sql",
    "0025_sponsor_spotlight_fields.sql",
    "0026_admin_audit_log.sql",
    "0027_admin_roles.sql",
    "0030_android_play_integrity.sql",
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

function seedPracticeConfig(database) {
  const now = Date.now();
  const config = {
    schema_version: 1,
    revision: 1,
    published_at: new Date(now).toISOString(),
    cache_ttl_seconds: 900,
    home: { show_todays_five: true, show_gather_people: true, show_sharp_sharp: false, event_banner: null },
    categories: [],
    events: { odogwu_league: {
      enabled: true, entry_enabled: true, visible_from: null, starts_at: null, ends_at: null,
      mode: "practice", home_placement: "banner", headline: "Practice League", rules_url: null,
      content_release_id: null, cash_enabled: false, weekly_schedule: null,
    } },
  };
  database.sqlite.prepare(`INSERT INTO app_config_revisions
    (id, revision, status, config_json, created_by, reason, created_at, published_at)
    VALUES ('practice-config', 1, 'published', ?1, 'test-owner', 'practice fixture', ?2, ?2)`)
    .run(JSON.stringify(config), now);
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

test("internal rehearsal payout preview is rank-gated and never creates a payable bank-details record", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database); seedCompetition(database); seedPracticeConfig(database);
  database.sqlite.prepare("UPDATE competitions SET slug = 'gist-league-internal-rehearsal' WHERE id = 'competition-week-1'").run();
  const worker = await builtWorker();
  const guestResponse = await request(worker, database, "/api/v1/players/guest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "android" }) });
  assert.equal(guestResponse.status, 201);
  const guest = await guestResponse.json();
  const now = Date.now();
  database.sqlite.prepare("UPDATE players SET public_handle='REHEARSAL-WINNER' WHERE id=?1").run(guest.player.id);
  const insertPlayer = database.sqlite.prepare("INSERT INTO players (id,public_handle,created_at,updated_at) VALUES (?1,?2,?3,?3)");
  const insertAttempt = database.sqlite.prepare(`INSERT INTO attempts (
    id,competition_id,player_id,attempt_token_hash,rules_version,pack_version,scoring_version,
    status,score_status,integrity_status,correct_count,adjusted_total_ms,hard_card_ms,
    started_at,play_deadline_at,submit_deadline_at,created_at,updated_at
  ) VALUES (?1,'competition-week-1',?2,?3,'rules-v1','pack-v1','accuracy-time-v1',
    'submitted','provisional','passed',?4,?5,100,?6,?7,?8,?6,?6)`);
  insertAttempt.run("rehearsal-winner-attempt", guest.player.id, "winner-token-hash", 12, 1000, now, now + 144_000, now + 159_000);
  for (let rank = 2; rank <= 4; rank++) {
    const playerId = `rehearsal-player-${rank}`;
    insertPlayer.run(playerId, `REHEARSAL-${rank}`, now);
    insertAttempt.run(`rehearsal-attempt-${rank}`, playerId, `rehearsal-token-${rank}`, 13 - rank, rank * 1000, now, now + 144_000, now + 159_000);
  }
  const headers = { authorization: `Bearer ${guest.session.token}`, "content-type": "application/json" };
  const preview = await request(worker, database, "/api/v1/me/rehearsal/payout-preview", {
    method: "POST", headers,
    body: JSON.stringify({ competition_id: "competition-week-1", legal_name: "Test Winner", bank_name: "Dummy Bank", account_number: "123456789012" }),
  });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).payout_details.status, "test_saved");
  const saved = database.sqlite.prepare("SELECT rank_at_submission,display_name,bank_label,account_last4,country_code FROM rehearsal_payout_previews WHERE player_id=?1").get(guest.player.id);
  assert.deepEqual({ ...saved }, { rank_at_submission: 1, display_name: "Test Winner", bank_label: "Dummy Bank", account_last4: "9012", country_code: "NG" });
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM competition_payout_details").get().count, 0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM competition_payouts").get().count, 0);

  database.sqlite.prepare("UPDATE attempts SET correct_count=8 WHERE id='rehearsal-winner-attempt'").run();
  const rankFour = await request(worker, database, "/api/v1/me/rehearsal/payout-preview", {
    method: "POST", headers,
    body: JSON.stringify({ competition_id: "competition-week-1", legal_name: "Test Winner", bank_name: "Dummy Bank", account_number: "123456789012" }),
  });
  assert.equal(rankFour.status, 409);
  assert.equal((await rankFour.json()).error.code, "rehearsal_payout_preview_not_top_three");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM rehearsal_payout_previews").get().count, 1);

  database.sqlite.prepare("UPDATE competitions SET slug='season-1-week-1' WHERE id='competition-week-1'").run();
  const nonRehearsal = await request(worker, database, "/api/v1/me/rehearsal/payout-preview", {
    method: "POST", headers,
    body: JSON.stringify({ competition_id: "competition-week-1", legal_name: "Test Winner", bank_name: "Dummy Bank", account_number: "123456789012" }),
  });
  assert.equal(nonRehearsal.status, 404);
  assert.equal((await nonRehearsal.json()).error.code, "rehearsal_payout_preview_unavailable");
});

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

test("the payout table rejects a non-NGN record even outside the Worker", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const now = Date.now();
  database.sqlite.prepare(
    `INSERT INTO players (id, public_handle, created_at, updated_at)
     VALUES ('payout-currency-player', 'PAYOUT-CURRENCY', ?1, ?1)`,
  ).run(now);
  database.sqlite.prepare(
    `INSERT INTO attempts (
      id, competition_id, player_id, attempt_token_hash, rules_version,
      pack_version, scoring_version, started_at, play_deadline_at,
      submit_deadline_at, created_at, updated_at
    ) VALUES (
      'payout-currency-attempt', 'competition-week-1', 'payout-currency-player',
      'payout-currency-token', 'rules-v1', 'pack-v1', 'accuracy-time-v1',
      ?1, ?2, ?3, ?1, ?1
    )`,
  ).run(now, now + 144_000, now + 159_000);

  assert.throws(
    () => database.sqlite.prepare(
      `INSERT INTO competition_payouts (
        id, competition_id, attempt_id, player_id, place, amount_minor,
        currency, created_by, created_at, updated_at
      ) VALUES (
        'payout-currency-usd', 'competition-week-1', 'payout-currency-attempt',
        'payout-currency-player', 1, 50_000, 'USD', 'test-operator', ?1, ?1
      )`,
    ).run(now),
    /competition payout currency must be NGN/,
  );
});

test("the owner payout list includes the reconciliation audit without payout details", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const now = Date.now();
  database.sqlite.prepare(
    `INSERT INTO players (id, public_handle, created_at, updated_at)
     VALUES ('payout-audit-player', 'PAYOUT-AUDIT', ?1, ?1)`,
  ).run(now);
  database.sqlite.prepare(
    `INSERT INTO attempts (
      id, competition_id, player_id, attempt_token_hash, rules_version,
      pack_version, scoring_version, started_at, play_deadline_at,
      submit_deadline_at, created_at, updated_at
    ) VALUES (
      'payout-audit-attempt', 'competition-week-1', 'payout-audit-player',
      'payout-audit-token', 'rules-v1', 'pack-v1', 'accuracy-time-v1',
      ?1, ?2, ?3, ?1, ?1
    )`,
  ).run(now, now + 144_000, now + 159_000);
  database.sqlite.prepare(
    `INSERT INTO competition_payouts (
      id, competition_id, attempt_id, player_id, place, amount_minor,
      currency, status, created_by, approved_by, sent_by, transfer_reference,
      created_at, updated_at
    ) VALUES (
      'payout-audit-record', 'competition-week-1', 'payout-audit-attempt',
      'payout-audit-player', 1, 50_000, 'NGN', 'sent', 'creator', 'approver',
      'sender', 'ngn-provider-ref-001', ?1, ?1
    )`,
  ).run(now);
  const auditInsert = database.sqlite.prepare(
    `INSERT INTO competition_payout_audit (
      id, payout_id, action, actor, note, details_json, changed_at
    ) VALUES (?1, 'payout-audit-record', ?2, ?3, ?4, ?5, ?6)`,
  );
  auditInsert.run("payout-audit-created", "created", "creator", "Created after independent review.", "{}", now);
  auditInsert.run("payout-audit-sent", "sent", "sender", "Released after approval.", JSON.stringify({ transfer_reference: "ngn-provider-ref-001" }), now + 1);

  const worker = await builtWorker();
  const response = await request(
    worker,
    database,
    "/api/v1/admin/cash/payouts?competition_id=competition-week-1",
    { headers: { authorization: "Bearer owner-token-with-enough-length" } },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.payouts.length, 1);
  assert.equal(body.payouts[0].currency, "NGN");
  assert.equal(body.payouts[0].audit.length, 2);
  assert.equal(body.payouts[0].audit[0].action, "created");
  assert.equal(body.payouts[0].audit[1].action, "sent");
  assert.equal(body.payouts[0].audit[1].details_json, JSON.stringify({ transfer_reference: "ngn-provider-ref-001" }));
  assert.equal("bank_account" in body.payouts[0], false);

  const sharedTokenMutation = await request(
    worker,
    database,
    "/api/v1/admin/cash/payouts/payout-audit-record/status",
    {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token-with-enough-length",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "cancelled",
        note: "This shared token must not be allowed to alter a payout.",
      }),
    },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(sharedTokenMutation.status, 409);
  const sharedTokenError = await sharedTokenMutation.json();
  assert.equal(sharedTokenError.error.code, "payout_individual_operator_required");
});

test("cleared finalists repair their scores and create exactly one payout per winner", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const now = Date.now();
  database.sqlite.prepare("UPDATE competitions SET status='locked', closes_at=? WHERE id='competition-week-1'").run(now - 1000);
  for (let place = 1; place <= 3; place++) {
    database.sqlite.prepare("INSERT INTO players (id,public_handle,created_at,updated_at) VALUES (?,?,?,?)").run(`winner-${place}`, `WINNER-${place}`, now, now);
    database.sqlite.prepare(`INSERT INTO attempts (id,competition_id,player_id,attempt_token_hash,rules_version,pack_version,scoring_version,status,score_status,integrity_status,correct_count,adjusted_total_ms,hard_card_ms,started_at,play_deadline_at,submit_deadline_at,created_at,updated_at)
      VALUES (?,'competition-week-1',?,?,'rules-v1','pack-v1','accuracy-time-v1','submitted','provisional','passed',?,1000,100,?,?,?, ?,?)`).run(`attempt-${place}`, `winner-${place}`, `token-${place}`, 13-place, now-2000, now-1000, now, now, now);
    database.sqlite.prepare(`INSERT INTO competition_reviews (id,attempt_id,competition_id,player_id,status,created_at,updated_at) VALUES (?,?,'competition-week-1',?,'cleared',?,?)`).run(`review-${place}`, `attempt-${place}`, `winner-${place}`, now, now);
    database.sqlite.prepare("INSERT INTO competition_prizes (competition_id,place,amount_minor) VALUES ('competition-week-1',?,?)").run(place, (4-place)*10000);
  }
  const worker = await builtWorker();
  const options = { headers: { authorization: "Bearer owner-token-with-enough-length" } };
  const env = { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" };
  for (let repeat=0; repeat<2; repeat++) {
    const response = await request(worker, database, "/api/v1/admin/cash/payouts?competition_id=competition-week-1", options, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).payouts.length, 3);
  }
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempts WHERE score_status='confirmed'").get().count, 3);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM competition_payout_audit WHERE action='created'").get().count, 3);
  const publicResult = await request(worker, database, "/api/v1/competitions/latest-completed", {}, env);
  assert.equal(publicResult.status, 200);
  assert.equal((await publicResult.json()).total_ranked, 3);
});

test("owner leaderboard is protected and close review preparation waits for the round to close", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const worker = await builtWorker();
  const unauthorized = await request(worker, database, "/api/v1/admin/leaderboard?competition_id=competition-week-1", { headers: { authorization: "Bearer wrong-token-with-enough-length" } }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(unauthorized.status, 401);
  const leaderboard = await request(worker, database, "/api/v1/admin/leaderboard?competition_id=competition-week-1", { headers: { authorization: "Bearer owner-token-with-enough-length" } }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(leaderboard.status, 200);
  assert.deepEqual((await leaderboard.json()).leaderboard, []);
  const prepare = await request(worker, database, "/api/v1/admin/competitions/competition-week-1/prepare-review", { method: "POST", headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" }, body: "{}" }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(prepare.status, 409);
  assert.equal((await prepare.json()).error.code, "competition_not_closed");
});

test("owner can safely enable or disable delegated roles and every change is audited", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
  const disabled = await request(worker, database, "/api/v1/admin/settings/roles/admin-role-support", { method: "POST", headers, body: JSON.stringify({ enabled: false, reason: "Pause support delegation during launch review." }) }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(disabled.status, 200);
  assert.equal(database.sqlite.prepare("SELECT enabled FROM admin_roles WHERE id = ?").get("admin-role-support").enabled, 0);
  assert.equal(database.sqlite.prepare("SELECT action FROM admin_audit_log WHERE action = ? ORDER BY changed_at DESC LIMIT 1").get("admin_role_updated").action, "admin_role_updated");
  const permissions = await request(worker, database, "/api/v1/admin/settings/roles/admin-role-support", { method: "POST", headers, body: JSON.stringify({ permissions: ["players.read", "support.read", "support.update", "cases.export"], reason: "Add support case export access." }) }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(permissions.status, 200);
  assert.deepEqual(JSON.parse(database.sqlite.prepare("SELECT permissions_json FROM admin_roles WHERE id = ?").get("admin-role-support").permissions_json), ["players.read", "support.read", "support.update", "cases.export"]);
  const ownerDisable = await request(worker, database, "/api/v1/admin/settings/roles/admin-role-owner", { method: "POST", headers, body: JSON.stringify({ enabled: false, reason: "Should be rejected." }) }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(ownerDisable.status, 409);
  assert.equal((await ownerDisable.json()).error.code, "owner_role_cannot_disable");
});

test("owner can permanently delete an empty cancelled competition and its policy history", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const now = Date.now();
  database.sqlite.prepare(`INSERT INTO competitions (
    id, slug, title, status, content_status, rules_version, pack_version,
    scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
    entry_mode, country_code, minimum_age, currency,
    opens_at, closes_at, score_review_closes_at, created_at, updated_at
  ) VALUES (?, ?, ?, 'cancelled', 'published', ?, ?, 'accuracy-time-v1',
    12, 12000, 15000, 'phone_verified', 'NG', 18, 'NGN', ?, ?, ?, ?, ?)`).run(
    "empty-cancelled",
    "empty-cancelled",
    "Empty cancelled round",
    "rules-v1",
    "pack-v1",
    now - 120_000,
    now - 60_000,
    now,
    now,
    now,
  );
  database.sqlite.prepare(`INSERT INTO competition_eligibility_policy_audit
    (id, competition_id, eligible_countries_json, actor, note, changed_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    "empty-policy-audit",
    "empty-cancelled",
    '["NG"]',
    "owner",
    "Initial policy",
    now,
  );
  const worker = await builtWorker();
  const response = await request(
    worker,
    database,
    "/api/v1/admin/competitions/empty-cancelled",
    {
      method: "DELETE",
      headers: {
        authorization: "Bearer owner-token-with-enough-length",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "Remove empty rehearsal record." }),
    },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM competitions WHERE id = ?").get("empty-cancelled").count, 0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM competition_eligibility_policy_audit WHERE competition_id = ?").get("empty-cancelled").count, 0);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'competition_deleted' AND resource_id = ?").get("empty-cancelled").count, 1);
});

test("owner cannot open a second competition while another session is open", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const worker = await builtWorker();
  const now = Date.now();
  const created = await request(
    worker,
    database,
    "/api/v1/admin/competitions",
    {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token-with-enough-length",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Second session",
        slug: "second-session",
        start_at: new Date(now + 60_000).toISOString(),
        end_at: new Date(now + 120_000).toISOString(),
        question_count: 12,
        reason: "Test single-session guard.",
      }),
    },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(created.status, 201);
  const competitionID = (await created.json()).competition.id;
  const opened = await request(
    worker,
    database,
    `/api/v1/admin/competitions/${competitionID}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token-with-enough-length",
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "open", reason: "Attempt second open session." }),
    },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(opened.status, 409);
  assert.equal((await opened.json()).error.code, "competition_overlap");
});

test("editing an open competition to a future window keeps it scheduled for automatic opening", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedPracticeConfig(database);
  seedCompetition(database);
  const worker = await builtWorker();
  const now = Date.now();
  const startAt = now + 60_000;
  const endAt = now + 120_000;
  const response = await request(worker, database, "/api/v1/admin/competitions/competition-week-1", {
    method: "POST",
    headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" },
    body: JSON.stringify({
      status: "open",
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      reason: "Move the session to the corrected start time.",
    }),
  }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(response.status, 200);
  const saved = database.sqlite.prepare("SELECT status, opens_at, closes_at FROM competitions WHERE id = ?").get("competition-week-1");
  assert.equal(saved.status, "scheduled");
  assert.ok(Math.abs(saved.opens_at - startAt) < 2_000);
  assert.ok(Math.abs(saved.closes_at - endAt) < 2_000);
});

test("Odogwu cannot open unless the published player banner is enabled", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const now = Date.now();
  const created = await request(worker, database, "/api/v1/admin/competitions", {
    method: "POST",
    headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" },
    body: JSON.stringify({
      title: "Banner gate test",
      slug: "banner-gate-test",
      start_at: new Date(now + 60_000).toISOString(),
      end_at: new Date(now + 120_000).toISOString(),
      question_count: 12,
      reason: "Verify the banner is mandatory before launch.",
    }),
  }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(created.status, 201);
  const id = (await created.json()).competition.id;
  const opened = await request(worker, database, `/api/v1/admin/competitions/${id}`, {
    method: "POST",
    headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" },
    body: JSON.stringify({ status: "open", reason: "Attempt launch without banner." }),
  }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(opened.status, 409);
  assert.equal((await opened.json()).error.code, "odogwu_banner_required");
});

test("Odogwu cannot start after the banner's explicit scheduled hide time", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedPracticeConfig(database);
  const now = Date.now();
  const configRow = database.sqlite.prepare("SELECT config_json FROM app_config_revisions WHERE id = 'practice-config'").get();
  const config = JSON.parse(configRow.config_json);
  config.events.odogwu_league.banner_ends_at = new Date(now + 60_000).toISOString();
  database.sqlite.prepare("UPDATE app_config_revisions SET config_json = ? WHERE id = 'practice-config'").run(JSON.stringify(config));
  seedCompetition(database);
  database.sqlite.prepare("UPDATE competitions SET status = 'draft', content_status = 'published', opens_at = ?, closes_at = ? WHERE id = 'competition-week-1'").run(now + 120_000, now + 240_000);
  const worker = await builtWorker();
  const response = await request(worker, database, "/api/v1/admin/competitions/competition-week-1", {
    method: "POST",
    headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" },
    body: JSON.stringify({ status: "scheduled", reason: "Verify banner lifecycle gate." }),
  }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "odogwu_banner_scheduled_off");
});

test("a competition cannot be opened before its question cards are published", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  seedPracticeConfig(database);
  database.sqlite.prepare("UPDATE competitions SET status = 'draft', content_status = 'draft' WHERE id = 'competition-week-1'").run();
  const worker = await builtWorker();
  const response = await request(worker, database, "/api/v1/admin/competitions/competition-week-1", {
    method: "POST",
    headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" },
    body: JSON.stringify({ status: "open", reason: "Verify unpublished content cannot launch." }),
  }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "competition_content_unpublished");
});

test("competition reads automatically open due scheduled rounds and close expired rounds", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const now = Date.now();
  database.sqlite.prepare(`INSERT INTO competitions (
    id, slug, title, status, content_status, rules_version, pack_version,
    scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
    entry_mode, country_code, minimum_age, currency,
    opens_at, closes_at, score_review_closes_at, created_at, updated_at
  ) VALUES (?, ?, ?, 'scheduled', 'published', 'rules-v1', 'pack-v1',
    'accuracy-time-v1', 1, 12000, 15000, 'guest', 'NG', 18, 'NGN',
    ?, ?, ?, ?, ?)`).run(
    "scheduled-due", "scheduled-due", "Scheduled due round", now - 1_000, now + 60_000, now + 120_000, now, now,
  );
  database.sqlite.prepare(`INSERT INTO competition_cards (
    id, competition_id, source_card_id, position, content_version, category,
    answer_family, clues_json, correct_option_id, difficulty, editorial_status,
    verification_note, source_urls_json, reviewed_by, reviewed_at, created_at, updated_at
  ) VALUES ('scheduled-card', 'scheduled-due', 'scheduled-source', 1, 'content-v1',
    'Food', 'Nigerian soups', '[]', 'scheduled-option', 'standard', 'approved',
    'Fixture card', '[]', 'test', ?, ?, ?)`
  ).run(now, now, now);
  database.sqlite.prepare(`INSERT INTO competitions (
    id, slug, title, status, content_status, rules_version, pack_version,
    scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
    entry_mode, country_code, minimum_age, currency,
    opens_at, closes_at, score_review_closes_at, created_at, updated_at
  ) VALUES (?, ?, ?, 'open', 'published', 'rules-v1', 'pack-v1',
    'accuracy-time-v1', 12, 12000, 15000, 'guest', 'NG', 18, 'NGN',
    ?, ?, ?, ?, ?)`).run(
    "expired-open", "expired-open", "Expired open round", now - 120_000, now - 1_000, now, now, now,
  );
  database.sqlite.prepare(`INSERT INTO competitions (
    id, slug, title, status, content_status, rules_version, pack_version,
    scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
    entry_mode, country_code, minimum_age, currency,
    opens_at, closes_at, score_review_closes_at, created_at, updated_at
  ) VALUES (?, ?, ?, 'scheduled', 'draft', 'rules-v1', 'pack-v1',
    'accuracy-time-v1', 1, 12000, 15000, 'guest', 'NG', 18, 'NGN',
    ?, ?, ?, ?, ?)`).run(
    "invalid-scheduled", "invalid-scheduled", "Invalid scheduled round", now - 1_000, now + 60_000, now + 120_000, now, now,
  );
  const worker = await builtWorker();
  const response = await request(
    worker,
    database,
    "/api/v1/admin/competitions",
    { headers: { authorization: "Bearer owner-token-with-enough-length" } },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(response.status, 200);
  assert.equal(database.sqlite.prepare("SELECT status FROM competitions WHERE id = ?").get("scheduled-due").status, "open");
  assert.equal(database.sqlite.prepare("SELECT status FROM competitions WHERE id = ?").get("expired-open").status, "locked");
  assert.equal(database.sqlite.prepare("SELECT status FROM competitions WHERE id = ?").get("invalid-scheduled").status, "cancelled");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action IN ('competition_auto_opened','competition_auto_locked')").get().count, 2);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'competition_auto_cancelled_invalid_content'").get().count, 1);
});

test("automatic lifecycle reconciliation never opens a scheduled round after the banner is turned off", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedPracticeConfig(database);
  const now = Date.now();
  const configRow = database.sqlite.prepare("SELECT config_json FROM app_config_revisions WHERE id = 'practice-config'").get();
  const config = JSON.parse(configRow.config_json);
  config.events.odogwu_league.banner_ends_at = new Date(now - 1_000).toISOString();
  database.sqlite.prepare("UPDATE app_config_revisions SET config_json = ? WHERE id = 'practice-config'").run(JSON.stringify(config));
  seedCompetition(database);
  database.sqlite.prepare(`UPDATE competitions SET title = 'Odogwu League — Week 1', status = 'scheduled', content_status = 'published', opens_at = ?, closes_at = ? WHERE id = 'competition-week-1'`).run(now - 1_000, now + 60_000);
  const worker = await builtWorker();
  const response = await request(worker, database, "/api/v1/admin/competitions", { headers: { authorization: "Bearer owner-token-with-enough-length" } }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(response.status, 200);
  assert.equal(database.sqlite.prepare("SELECT status FROM competitions WHERE id = ?").get("competition-week-1").status, "cancelled");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'competition_auto_cancelled_banner_unavailable'").get().count, 1);
});

test("banner protection does not cancel unrelated scheduled competitions", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedPracticeConfig(database);
  const now = Date.now();
  const configRow = database.sqlite.prepare("SELECT config_json FROM app_config_revisions WHERE id = 'practice-config'").get();
  const config = JSON.parse(configRow.config_json);
  config.events.odogwu_league.banner_ends_at = new Date(now - 1_000).toISOString();
  database.sqlite.prepare("UPDATE app_config_revisions SET config_json = ? WHERE id = 'practice-config'").run(JSON.stringify(config));
  seedCompetition(database);
  database.sqlite.prepare(`UPDATE competitions SET status = 'scheduled', content_status = 'published', opens_at = ?, closes_at = ? WHERE id = 'competition-week-1'`).run(now - 1_000, now + 60_000);
  const worker = await builtWorker();
  const response = await request(worker, database, "/api/v1/admin/competitions", { headers: { authorization: "Bearer owner-token-with-enough-length" } }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(response.status, 200);
  assert.equal(database.sqlite.prepare("SELECT status FROM competitions WHERE id = ?").get("competition-week-1").status, "open");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'competition_auto_cancelled_banner_unavailable'").get().count, 0);
});

test("automatic lifecycle reconciliation never opens a scheduled round over a live round", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  const now = Date.now();
  database.sqlite.prepare(`INSERT INTO competitions (
    id, slug, title, status, content_status, rules_version, pack_version,
    scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
    entry_mode, country_code, minimum_age, currency,
    opens_at, closes_at, score_review_closes_at, created_at, updated_at
  ) VALUES (?, ?, ?, 'scheduled', 'published', 'rules-v1', 'pack-v1',
    'accuracy-time-v1', 1, 12000, 15000, 'guest', 'NG', 18, 'NGN',
    ?, ?, ?, ?, ?)`).run(
    "scheduled-overlap", "scheduled-overlap", "Scheduled overlap", now - 1_000, now + 60_000, now + 120_000, now, now,
  );
  database.sqlite.prepare(`INSERT INTO competition_cards (
    id, competition_id, source_card_id, position, content_version, category,
    answer_family, clues_json, correct_option_id, difficulty, editorial_status,
    verification_note, source_urls_json, reviewed_by, reviewed_at, created_at, updated_at
  ) VALUES ('overlap-card', 'scheduled-overlap', 'overlap-source', 1, 'content-v1',
    'Food', 'Nigerian soups', '[]', 'overlap-option', 'standard', 'approved',
    'Fixture card', '[]', 'test', ?, ?, ?)`
  ).run(now, now, now);
  const worker = await builtWorker();
  const response = await request(
    worker,
    database,
    "/api/v1/admin/competitions",
    { headers: { authorization: "Bearer owner-token-with-enough-length" } },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(response.status, 200);
  assert.equal(database.sqlite.prepare("SELECT status FROM competitions WHERE id = ?").get("scheduled-overlap").status, "scheduled");
});

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
  assert.match(created.room_code, /^\d{4}$/);
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

test("Project to Big Screen uses separate viewer and publisher capabilities and expires on stop", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }),
  });
  const guest = await guestResponse.json();
  const rooms = new TestPlayOnCallRooms();
  const env = {
    PLAY_ON_CALL_ROOMS: rooms,
    WBD_PLAY_ON_CALL_SIGNING_SECRET: "play-on-call-api-test-secret-that-is-at-least-thirty-two-characters",
  };
  const createdResponse = await request(worker, database, "/api/v1/tv-displays", {
    method: "POST",
    headers: { authorization: `Bearer ${guest.session.token}`, "content-type": "application/json" },
    body: "{}",
  }, env);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.session_id, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.equal(created.pairing_code, created.session_id);
  assert.equal(created.display_url, "https://play.wetinbedis.com/screen");
  const tvPage = await request(worker, database, new URL(created.display_url).pathname);
  assert.equal(tvPage.status, 200);
  const tvMarkup = await tvPage.text();
  assert.match(tvMarkup, /DON’T SAY/);
  assert.match(tvMarkup, /viewport-fit=cover/);
  assert.match(tvMarkup, /Join game/);
  assert.match(tvMarkup, /4-character code/);
  assert.match(tvMarkup, /app-join-qr\.svg/);

  const publishPath = `/api/v1/tv-displays/${created.session_id}`;
  const state = {
    phase: "playing", team: "Team 1", round: 2, round_duration: 45, seconds_remaining: 30, score: 4,
    category: "Food", difficulty: "Medium", answer: "Jollof Rice", forbidden_words: ["Tomato", "Party", "Pot"],
  };
  const rejectedPublish = await request(worker, database, publishPath, {
    method: "PUT", headers: { "content-type": "application/json", "x-wbd-tv-owner-token": created.owner_token },
    body: JSON.stringify({ ...state, answer: "x".repeat(101) }),
  }, env);
  assert.equal(rejectedPublish.status, 400);

  const publish = await request(worker, database, publishPath, {
    method: "PUT", headers: { "content-type": "application/json", "x-wbd-tv-owner-token": created.owner_token },
    body: JSON.stringify(state),
  }, env);
  assert.equal(publish.status, 200);

  const otherCode = created.session_id === "2222" ? "2223" : "2222";
  const wrongViewer = await request(worker, database, `/api/v1/tv-displays/${otherCode}`, {}, env);
  assert.equal(wrongViewer.status, 410);
  const viewer = await request(worker, database, publishPath, {}, env);
  assert.equal(viewer.status, 200);
  assert.equal((await viewer.json()).state.answer, "Jollof Rice");

  const viewerCannotPublish = await request(worker, database, publishPath, {
    method: "PUT", headers: { "content-type": "application/json", "x-wbd-tv-owner-token": created.pairing_code },
    body: JSON.stringify(state),
  }, env);
  assert.equal(viewerCannotPublish.status, 403);

  const stop = await request(worker, database, publishPath, {
    method: "DELETE", headers: { "x-wbd-tv-owner-token": created.owner_token },
  }, env);
  assert.equal(stop.status, 200);
  const expired = await request(worker, database, publishPath, {}, env);
  assert.equal(expired.status, 410);
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

test("a deletion request cannot be completed while a League attempt is active", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  seedPracticeConfig(database);
  const worker = await builtWorker();
  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const guest = await guestResponse.json();
  const playerHeaders = {
    authorization: `Bearer ${guest.session.token}`,
    "content-type": "application/json",
  };
  const privacyResponse = await request(worker, database, "/api/v1/me/privacy-requests", {
    method: "POST",
    headers: playerHeaders,
    body: JSON.stringify({
      type: "deletion",
      statement: "Please review deletion after the active League work is complete.",
    }),
  });
  assert.equal(privacyResponse.status, 201);
  const privacy = await privacyResponse.json();

  const now = Date.now();
  database.sqlite.prepare(
    `INSERT INTO attempts (
      id, competition_id, player_id, attempt_token_hash, rules_version,
      pack_version, scoring_version, started_at, play_deadline_at,
      submit_deadline_at, created_at, updated_at
    ) VALUES (
      'privacy-hold-attempt', 'competition-week-1', ?1, 'privacy-hold-token',
      'rules-v1', 'pack-v1', 'accuracy-time-v1', ?2, ?3, ?4, ?2, ?2
    )`,
  ).run(guest.player.id, now, now + 144_000, now + 159_000);

  const completion = await request(
    worker,
    database,
    `/api/v1/admin/privacy/requests/${privacy.request.id}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token-with-enough-length",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "completed",
        note: "Checked the data request before completing it.",
      }),
    },
    { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" },
  );
  assert.equal(completion.status, 409);
  const error = await completion.json();
  assert.equal(error.error.code, "privacy_deletion_hold_active");
  assert.deepEqual(error.error.details.holds, ["active_attempt"]);
  assert.equal(
    database.sqlite.prepare("SELECT status FROM privacy_requests WHERE id = ?").get(privacy.request.id).status,
    "queued",
  );
});

test("runs the guarded practice competition flow against the generated schema", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  seedPracticeConfig(database);
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
  const gatedCashResponse = await request(
    worker,
    database,
    "/api/v1/competitions/current",
  );
  assert.equal(gatedCashResponse.status, 503);
  assert.equal((await gatedCashResponse.json()).error.code, "cash_launch_gated");

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

test("Odogwu provisioning creates a published card-backed round", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  database.sqlite.prepare("UPDATE competitions SET slug = 'gist-league-test-week-1' WHERE id = 'competition-week-1'").run();
  const worker = await builtWorker();
  const startsAt = new Date(Date.now() + 60_000).toISOString();
  const endsAt = new Date(Date.now() + 3_600_000).toISOString();
  const response = await request(worker, database, "/api/v1/admin/competitions/one-day-simulation", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token-with-enough-length",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      slug: "odogwu-league-provisioned-round",
      title: "Odogwu League — Provisioned Round",
      starts_at: startsAt,
      ends_at: endsAt,
      reason: "verify reviewed pack provisioning",
    }),
  }, { WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length" });
  assert.equal(response.status, 201);
  const body = await response.json();
  const competitionID = body.competition.id;
  const row = database.sqlite.prepare("SELECT status, content_status, question_count FROM competitions WHERE id = ?").get(competitionID);
  assert.equal(row.status, "open");
  assert.equal(row.content_status, "published");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM competition_cards WHERE competition_id = ?").get(competitionID).count, row.question_count);
  assert.equal(database.sqlite.prepare("SELECT action FROM admin_audit_log WHERE resource_id = ? ORDER BY changed_at DESC LIMIT 1").get(competitionID).action, "competition_created");
});

test("an accidental open guest prize row stays unavailable everywhere", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  seedPracticeConfig(database);
  seedPrizes(database);
  const worker = await builtWorker();
  const current = await request(worker, database, "/api/v1/competitions/current");
  assert.equal(current.status, 503);
  assert.equal((await current.json()).error.code, "cash_launch_gated");
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
  assert.equal(payload.error.code, "cash_launch_gated");
  assert.equal(payload.error.details.device_attestation_required, true);
  assert.equal(payload.error.details.trusted_timing_required, true);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);
});

test("a cash-eligible player is still blocked when their verified country is outside the round policy", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  seedPrizes(database);
  const now = Date.now();
  const config = {
    schema_version: 1,
    revision: 1,
    published_at: new Date(now).toISOString(),
    cache_ttl_seconds: 900,
    home: { show_todays_five: true, show_gather_people: true, show_sharp_sharp: false, event_banner: null },
    categories: [],
    events: {
      odogwu_league: {
        enabled: true,
        entry_enabled: true,
        visible_from: null,
        starts_at: null,
        ends_at: null,
        mode: "cash_ready",
        home_placement: "banner",
        headline: "Cash League",
        rules_url: "https://wetinbedis.com/rules/league-v1",
        content_release_id: null,
        cash_enabled: true,
        weekly_schedule: null,
      },
    },
  };
  database.sqlite.prepare(
    `INSERT INTO app_config_revisions (
      id, revision, status, config_json, created_by, reason, created_at, published_at
    ) VALUES ('cash-country-config', 1, 'published', ?1, 'test-owner', 'cash gate test', ?2, ?2)`,
  ).run(JSON.stringify(config), now);
  const gates = [
    "official_rules_and_eligibility",
    "phone_verification",
    "ios_app_attest",
    "android_play_integrity",
    "trusted_timing_and_private_content",
    "fraud_review_operations",
    "payout_operations_and_funding",
    "privacy_retention_and_deletion",
    "production_tests_and_incident_response",
  ];
  const gateInsert = database.sqlite.prepare(
    `INSERT INTO cash_launch_gates (
      gate_key, status, evidence_reference, note, reviewed_by, reviewed_at, updated_at
    ) VALUES (?1, 'passed', 'restricted-evidence/test', 'Test fixture only.', 'test-owner', ?2, ?2)`,
  );
  for (const gate of gates) gateInsert.run(gate, now);
  database.sqlite.prepare(
    `UPDATE competitions
     SET entry_mode = 'phone_verified', eligible_countries_json = '["US", "NG", "CA", "GB"]'
     WHERE id = 'competition-week-1'`,
  ).run();

  const worker = await builtWorker();
  const guestResponse = await request(worker, database, "/api/v1/players/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const guest = await guestResponse.json();
  database.sqlite.prepare(
    `UPDATE players
     SET account_state = 'phone_verified', phone_verified_at = ?1,
         country_code = 'FR', eligibility_status = 'eligible',
         accepted_rules_version = 'rules-v1'
     WHERE id = ?2`,
  ).run(now, guest.player.id);

  const androidCurrent = await request(worker, database, "/api/v1/competitions/current", {
    headers: { "x-wbd-client": "WetinBeDis-Android" },
  });
  assert.equal(androidCurrent.status, 200);
  const androidCompetition = (await androidCurrent.json()).competition;
  assert.equal(androidCompetition.mode, "practice");
  assert.equal(androidCompetition.prize_eligible, false);
  assert.equal(androidCompetition.attempt_availability.available, false);
  assert.equal(androidCompetition.attempt_availability.reason, "android_cash_scope_not_approved");
  assert.deepEqual(androidCompetition.prize.places, []);
  const androidScopeApproved = await request(worker, database, "/api/v1/competitions/current", {
    headers: { "x-wbd-client": "WetinBeDis-Android" },
  }, { WBD_ANDROID_CASH_ENTRY_ENABLED: "true" });
  assert.equal(androidScopeApproved.status, 200);
  assert.equal((await androidScopeApproved.json()).competition.prize_eligible, true);

  const androidAttempt = await request(worker, database, "/api/v1/competitions/competition-week-1/attempts", {
    method: "POST",
    headers: { authorization: `Bearer ${guest.session.token}`, "x-wbd-client": "WetinBeDis-Android" },
  });
  assert.equal(androidAttempt.status, 403);
  assert.equal((await androidAttempt.json()).error.code, "android_cash_entry_not_approved");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);

  const response = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    { method: "POST", headers: { authorization: `Bearer ${guest.session.token}` } },
  );
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "competition_country_ineligible");
  assert.deepEqual(body.error.details.eligible_countries, ["US", "NG", "CA", "GB"]);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);

  database.sqlite.prepare("UPDATE players SET country_code = 'CA' WHERE id = ?").run(guest.player.id);
  const started = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts",
    { method: "POST", headers: { authorization: `Bearer ${guest.session.token}` } },
  );
  assert.equal(started.status, 201);
  const startedBody = await started.json();
  assert.equal(startedBody.attempt.delivery_protocol, "cash_sequential_v1");
  assert.equal(startedBody.attempt.card, undefined);
  assert.deepEqual(startedBody.attempt.cards, []);

  const appAttestEnvironment = {
    WBD_APP_ATTEST_APP_ID: "TESTTEAMID.com.wetinbedis.ios",
    WBD_APP_ATTEST_ENVIRONMENT: "development",
  };
  const withheld = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts/active",
    {
      headers: {
        authorization: `Bearer ${guest.session.token}`,
        "x-wbd-attempt-token": startedBody.attempt.token,
      },
    },
    appAttestEnvironment,
  );
  assert.equal(withheld.status, 200);
  const withheldBody = await withheld.json();
  assert.equal(withheldBody.attempt.card, undefined);
  assert.deepEqual(withheldBody.attempt.cards, []);
  assert.equal(withheldBody.attempt.device_verification_required, true);

  const attestationNow = Date.now();
  database.sqlite.prepare(
    `INSERT INTO app_attest_keys (
      key_id, player_id, app_id, environment, public_key_pem,
      assertion_counter, attested_at, last_verified_at, created_at, updated_at
    ) VALUES ('this-installation-key', ?1, ?2, 'development', 'test-public-key', 0, ?3, ?3, ?3, ?3)`,
  ).run(guest.player.id, appAttestEnvironment.WBD_APP_ATTEST_APP_ID, attestationNow);

  const otherDevice = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts/active",
    {
      headers: {
        authorization: `Bearer ${guest.session.token}`,
        "x-wbd-attempt-token": startedBody.attempt.token,
        "x-wbd-app-attest-key-id": "another-installation-key",
      },
    },
    appAttestEnvironment,
  );
  assert.equal(otherDevice.status, 200);
  const otherDeviceBody = await otherDevice.json();
  assert.equal(otherDeviceBody.attempt.card, undefined);
  assert.equal(otherDeviceBody.attempt.device_verification_required, true);

  const verifiedDevice = await request(
    worker,
    database,
    "/api/v1/competitions/competition-week-1/attempts/active",
    {
      headers: {
        authorization: `Bearer ${guest.session.token}`,
        "x-wbd-attempt-token": startedBody.attempt.token,
        "x-wbd-app-attest-key-id": "this-installation-key",
      },
    },
    appAttestEnvironment,
  );
  assert.equal(verifiedDevice.status, 200);
  const verifiedDeviceBody = await verifiedDevice.json();
  assert.equal(verifiedDeviceBody.attempt.device_verification_required, undefined);
  assert.equal(verifiedDeviceBody.attempt.cards.length, 0);
  assert.equal(verifiedDeviceBody.attempt.card.id, "card-1");
});

test("the cash-answer route rejects a direct call without an authenticated active attempt", async (t) => {
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
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error.code, "authentication_required");
});

test("readiness and attempt creation fail closed when a prize card overlaps public content", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  seedCompetition(database);
  seedPracticeConfig(database);
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
  seedPracticeConfig(database);
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
  seedPracticeConfig(database);
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
  seedPracticeConfig(database);
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

test("League broadcasts route opted-in Android and iPhone devices through their own providers and prune only unregistered tokens", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  async function privateKey(algorithm) {
    const pair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    const bytes = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    return `-----BEGIN PRIVATE KEY-----\n${Buffer.from(bytes).toString("base64")}\n-----END PRIVATE KEY-----`;
  }
  const env = {
    WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length",
    WBD_PUSH_TOKEN_ENCRYPTION_SECRET: "notification-test-encryption-secret-with-enough-characters",
    WBD_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "test-project", client_email: "push@test-project.iam.gserviceaccount.com", private_key: await privateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }) }),
    WBD_APNS_KEY_ID: "TESTKEY", WBD_APNS_TEAM_ID: "TESTTEAM", WBD_APNS_BUNDLE_ID: "com.example.test", WBD_APNS_HOST: "https://api.sandbox.push.apple.com",
    WBD_APNS_PRIVATE_KEY: await privateKey({ name: "ECDSA", namedCurve: "P-256" }),
  };
  for (const [platform, token, optedIn] of [
    ["android", "dummy-good-android-token-for-contract-test", true],
    ["android", "dummy-gone-android-token-for-contract-test", true],
    ["android", "dummy-offers-only-token-for-contract-test", false],
    ["ios", "a".repeat(64), true],
  ]) {
    const guest = await (await request(worker, database, "/api/v1/players/guest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform }) })).json();
    const registered = await request(worker, database, "/api/v1/me/notification-devices", {
      method: "PUT", headers: { authorization: `Bearer ${guest.session.token}`, "content-type": "application/json" },
      body: JSON.stringify({ platform, token, preferences: { league_updates_enabled: optedIn, friend_invites_enabled: false, offers_enabled: !optedIn } }),
    }, env);
    assert.equal(registered.status, 200);
  }
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let googleAuth = 0; let googleSends = 0; let appleSends = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") { googleAuth++; return Response.json({ access_token: "test-google-token" }); }
    const payload = JSON.parse(init.body);
    if (url === "https://fcm.googleapis.com/v1/projects/test-project/messages:send") {
      googleSends++;
      assert.equal(payload.message.notification, undefined);
      assert.equal(payload.message.data.competition_id, "completed-round-2");
      assert.equal(payload.message.data.event, "results_ready");
      assert.notEqual(payload.message.token, "dummy-offers-only-token-for-contract-test");
      return payload.message.token.includes("gone")
        ? Response.json({ error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }, { status: 404 })
        : Response.json({ name: "test-message" });
    }
    if (url === `https://api.sandbox.push.apple.com/3/device/${"a".repeat(64)}`) {
      appleSends++;
      assert.equal(payload.route, "league/odogwu");
      assert.equal(payload.competition_id, "completed-round-2");
      assert.ok(payload.aps.alert.title);
      return new Response(null, { status: 200 });
    }
    throw new Error("Unexpected outbound request in notification contract test");
  };
  const response = await request(worker, database, "/api/v1/admin/notifications/league-broadcast", {
    method: "POST", headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" },
    body: JSON.stringify({ event: "results_ready", competition_id: "completed-round-2" }),
  }, env);
  assert.equal(response.status, 200);
  const { notification } = await response.json();
  assert.deepEqual([notification.eligible, notification.sent, notification.failed, notification.removed], [3, 2, 1, 1]);
  assert.deepEqual([googleAuth, googleSends, appleSends], [1, 2, 1]);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_devices").get().count, 3);
});

test("Android rehearsal registers a real-verdict-shaped proof before card one and binds every server-scored answer", async (t) => {
  const database = new TestD1Database(); t.after(() => database.close());
  await migrate(database); seedCompetition(database); seedPracticeConfig(database); seedPrizes(database);
  database.sqlite.prepare("UPDATE competitions SET slug = 'gist-league-internal-rehearsal' WHERE id = 'competition-week-1'").run();
  const worker = await builtWorker();
  const guestResponse = await request(worker, database, "/api/v1/players/guest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "android", app_version: "1.0.4" }) });
  assert.equal(guestResponse.status, 201);
  const guest = await guestResponse.json();
  assert.equal(database.sqlite.prepare("SELECT eligibility_status FROM players WHERE id = ?1").get(guest.player.id).eligibility_status, "guest",
    "The server rehearsal must remain enterable without turning a guest into a public cash-eligible player.");
  const headers = { authorization: `Bearer ${guest.session.token}`, "x-wbd-client": "WetinBeDis-Android" };
  const blocked = await request(worker, database, "/api/v1/competitions/competition-week-1/attempts", { method: "POST", headers });
  assert.equal(blocked.status, 503); assert.equal((await blocked.json()).error.code, "play_integrity_misconfigured");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64")}\n-----END PRIVATE KEY-----`;
  const certificate = Buffer.alloc(32, 23).toString("base64url");
  const env = { WBD_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "integrity@test-project.iam.gserviceaccount.com", private_key: pem }),
    WBD_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: "123456789012", WBD_PLAY_INTEGRITY_CERTIFICATE_SHA256: certificate };
  const nativeFetch = globalThis.fetch;
  const bindings = new Map(); let issuedTokens = 0; let decodedTokens = 0;
  globalThis.fetch = async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "test-integrity-access" });
    assert.equal(url, "https://playintegrity.googleapis.com/v1/com.davidadekanbi.wetinbedis:decodeIntegrityToken");
    const token = JSON.parse(init.body).integrity_token;
    const hash = bindings.get(token); assert.ok(hash, "Only an issued test token may reach the provider boundary"); decodedTokens++;
    return Response.json({ tokenPayloadExternal: {
      requestDetails: { requestPackageName: "com.davidadekanbi.wetinbedis", requestHash: hash, timestampMillis: String(Date.now()) },
      appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.davidadekanbi.wetinbedis", certificateSha256Digest: [certificate], versionCode: "5" },
      accountDetails: { appLicensingVerdict: "LICENSED" }, deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
    } });
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const proofFor = (challenge) => {
    const token = `test-encrypted-integrity-token-${++issuedTokens}`; bindings.set(token, challenge.request_hash);
    return { platform: "android-play-integrity", challenge_id: challenge.challenge_id, request_hash: challenge.request_hash, token };
  };
  const started = await request(worker, database, "/api/v1/competitions/competition-week-1/attempts", { method: "POST", headers }, env);
  assert.equal(started.status, 201); const { attempt } = await started.json();
  assert.equal(attempt.integrity_protocol, "play_integrity_standard_v1"); assert.equal(attempt.device_verification_required, true);
  assert.equal(attempt.card, undefined); assert.deepEqual(attempt.cards, []);
  const attemptHeaders = { ...headers, "x-wbd-attempt-token": attempt.token, "content-type": "application/json" };
  const base = `/api/v1/attempts/${attempt.id}`;
  const activePath = "/api/v1/competitions/competition-week-1/attempts/active";
  const withheld = await request(worker, database, activePath, { headers: attemptHeaders }, env);
  assert.equal((await withheld.json()).attempt.card, undefined);
  const regChallenge = await request(worker, database, `${base}/play-integrity/registration-challenge`, { method: "POST", headers: attemptHeaders }, env);
  assert.equal(regChallenge.status, 201); const registration = (await regChallenge.json()).challenge;
  const registrationProof = proofFor(registration);
  const registered = await request(worker, database, `${base}/play-integrity/register`, { method: "POST", headers: attemptHeaders, body: JSON.stringify({ integrity_proof: registrationProof }) }, env);
  assert.equal(registered.status, 201); assert.equal((await registered.json()).device.status, "verified");
  const clock = database.sqlite.prepare("SELECT started_at, play_deadline_at FROM attempts WHERE id = ?").get(attempt.id);
  assert.equal(clock.play_deadline_at - clock.started_at, 144000);
  const { claimAttemptDeviceBinding } = await import("../worker/api/attempt-device-binding.ts");
  assert.equal(await claimAttemptDeviceBinding(database, attempt.id, guest.player.id, "android-play-integrity", clock.started_at + 30000), clock.started_at);
  await assert.rejects(claimAttemptDeviceBinding(database, attempt.id, guest.player.id, "ios-app-attest", clock.started_at + 30000), (error) => error.code === "attempt_device_platform_mismatch");
  const replayRegister = await request(worker, database, `${base}/play-integrity/register`, { method: "POST", headers: attemptHeaders, body: JSON.stringify({ integrity_proof: registrationProof }) }, env);
  assert.equal(replayRegister.status, 409); assert.equal(decodedTokens, 1);
  assert.equal(database.sqlite.prepare("SELECT play_deadline_at FROM attempts WHERE id = ?").get(attempt.id).play_deadline_at, clock.play_deadline_at);
  const resumed = await request(worker, database, activePath, { headers: attemptHeaders }, env);
  const verifiedAttempt = (await resumed.json()).attempt;
  assert.equal(verifiedAttempt.device_verification_required, false); assert.equal(verifiedAttempt.card.position, 1);
  let firstProof;
  for (let position = 1; position <= 12; position++) {
    const selected = `card-${position}-option-1`;
    const challengeResponse = await request(worker, database, `${base}/play-integrity/cash-answer-challenge`, { method: "POST", headers: attemptHeaders, body: JSON.stringify({ selected_option_id: selected }) }, env);
    assert.equal(challengeResponse.status, 201); const challenge = (await challengeResponse.json()).challenge;
    const proof = proofFor(challenge);
    if (position === 1) {
      firstProof = proof;
      const swapped = await request(worker, database, `${base}/cash-answer`, { method: "POST", headers: attemptHeaders, body: JSON.stringify({ selected_option_id: "card-1-option-2", integrity_proof: proof }) }, env);
      assert.equal(swapped.status, 403); assert.equal((await swapped.json()).error.code, "play_integrity_binding_invalid"); assert.equal(decodedTokens, 1);
    }
    if (position === 2) {
      const replayed = await request(worker, database, `${base}/cash-answer`, { method: "POST", headers: attemptHeaders, body: JSON.stringify({ selected_option_id: selected, integrity_proof: firstProof }) }, env);
      assert.equal(replayed.status, 409);
    }
    const answered = await request(worker, database, `${base}/cash-answer`, { method: "POST", headers: attemptHeaders,
      body: JSON.stringify({ selected_option_id: selected, integrity_proof: proof, correct_count: 999, response_ms: 0 }) }, env);
    assert.equal(answered.status, 200); const result = await answered.json();
    if (position < 12) { assert.equal(result.card.position, position + 1); assert.equal(result.answered_count, position); }
    else { assert.equal(result.status, "finished"); assert.equal(result.score.correct_count, 12); assert.equal(result.score.status, "provisional"); assert.equal(result.score.prize_eligible, false); assert.equal(result.score.timing_trust, "server_authoritative"); }
  }
  assert.equal(decodedTokens, 13); assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempt_answers WHERE attempt_id = ?").get(attempt.id).count, 12);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM android_integrity_challenges WHERE consumed_at IS NOT NULL").get().count, 13);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM cash_launch_gates WHERE status = 'passed'").get().count, 0, "Mocked proofs must not turn on production cash gates");
});

test("a cash timeout cannot fabricate a score before any device proof was verified", async (t) => {
  const database = new TestD1Database(); t.after(() => database.close());
  await migrate(database); seedCompetition(database); seedPracticeConfig(database); seedPrizes(database);
  database.sqlite.prepare("UPDATE competitions SET slug = 'gist-league-internal-rehearsal' WHERE id = 'competition-week-1'").run();
  const worker = await builtWorker();
  const guest = await (await request(worker, database, "/api/v1/players/guest", { method: "POST" })).json();
  const started = await request(worker, database, "/api/v1/competitions/competition-week-1/attempts", { method: "POST", headers: { authorization: `Bearer ${guest.session.token}` } });
  assert.equal(started.status, 201); const { attempt } = await started.json();
  database.sqlite.prepare("UPDATE attempts SET play_deadline_at = ?2, submit_deadline_at = ?3 WHERE id = ?1").run(attempt.id, Date.now() - 1000, Date.now() + 60000);
  const timeout = await request(worker, database, `/api/v1/attempts/${attempt.id}/cash-timeout`, { method: "POST", headers: { authorization: `Bearer ${guest.session.token}`, "x-wbd-attempt-token": attempt.token } });
  assert.equal(timeout.status, 403); assert.equal((await timeout.json()).error.code, "device_verification_required");
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM attempt_answers WHERE attempt_id = ?").get(attempt.id).count, 0);
  assert.equal(database.sqlite.prepare("SELECT score_status FROM attempts WHERE id = ?").get(attempt.id).score_status, "unscored");
});


test("General announcements reach only opted-in iOS devices without a League banner or link", async (t) => {
  const database = new TestD1Database(); t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64")}\n-----END PRIVATE KEY-----`;
  const env = {
    WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length",
    WBD_PUSH_TOKEN_ENCRYPTION_SECRET: "notification-test-encryption-secret-with-enough-characters",
    WBD_APNS_KEY_ID: "TESTKEY", WBD_APNS_TEAM_ID: "TESTTEAM", WBD_APNS_BUNDLE_ID: "com.example.test",
    WBD_APNS_HOST: "https://api.sandbox.push.apple.com", WBD_APNS_PRIVATE_KEY: pem,
  };
  for (const [platform, token, offers, league] of [
    ["ios", "a".repeat(64), true, false],
    ["ios", "b".repeat(64), true, true],
    ["ios", "c".repeat(64), false, true],
    ["ios", "d".repeat(64), false, false],
    ["android", "dummy-offers-only-android-token-for-contract-test", true, false],
  ]) {
    const guest = await (await request(worker, database, "/api/v1/players/guest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform }) })).json();
    const registration = await request(worker, database, "/api/v1/me/notification-devices", {
      method: "PUT", headers: { authorization: `Bearer ${guest.session.token}`, "content-type": "application/json" },
      body: JSON.stringify({ platform, token, preferences: { league_updates_enabled: league, friend_invites_enabled: false, offers_enabled: offers } }),
    }, env);
    assert.equal(registration.status, 200);
  }
  const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
  const path = "/api/v1/admin/notifications/announcement-broadcast";
  const status = await (await request(worker, database, "/api/v1/admin/notifications/status", { headers }, env)).json();
  assert.deepEqual(status.announcements, { eligible_devices: 2, eligible_players: 2 });
  const previousFetch = globalThis.fetch; t.after(() => { globalThis.fetch = previousFetch; });
  const sends = [];
  globalThis.fetch = async (url, init) => {
    sends.push(String(url));
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.aps.alert, { title: "Na you make am sweet ❤️", body: "Thanks for playing! Share with your people." });
    assert.equal(payload.aps.category, "WBD_ANNOUNCEMENT");
    assert.equal(payload.route, undefined);
    assert.equal(payload.competition_id, undefined);
    assert.equal(payload.media_url, undefined);
    assert.equal(payload.event, "general_announcement");
    return new Response(null, { status: String(url).endsWith("b".repeat(64)) ? 410 : 200 });
  };
  const copy = { title: "Na you make am sweet ❤️", body: "Thanks for playing! Share with your people." };
  assert.equal((await request(worker, database, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(copy) }, env)).status, 401);
  for (const bad of [{}, { title: "Title" }, { body: "Message" }, { title: "x".repeat(81), body: "Message" }, { title: "Title", body: "x".repeat(241) }]) {
    assert.equal((await request(worker, database, path, { method: "POST", headers, body: JSON.stringify(bad) }, env)).status, 400);
  }
  assert.equal(sends.length, 0);
  const league = await request(worker, database, "/api/v1/admin/notifications/league-broadcast", { method: "POST", headers, body: JSON.stringify({ event: "started", ...copy }) }, env);
  assert.equal(league.status, 409, "League banner guard remains enforced");
  const response = await request(worker, database, path, { method: "POST", headers, body: JSON.stringify({ ...copy, competition_id: "cancelled-test", media_url: "https://example.test/league.png" }) }, env);
  assert.equal(response.status, 200);
  const { notification } = await response.json();
  assert.deepEqual([notification.eligible, notification.sent, notification.failed, notification.removed], [2, 1, 1, 1]);
  assert.deepEqual(sends.sort(), ["a", "b"].map(letter => `https://api.sandbox.push.apple.com/3/device/${letter.repeat(64)}`));
  const audit = database.sqlite.prepare("SELECT * FROM admin_audit_log WHERE action = 'notification_broadcast'").get();
  assert.ok(audit);
  assert.equal(JSON.parse(audit.details_json).event, "general_announcement");
});
