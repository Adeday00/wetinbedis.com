import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFile = promisify(execFileCallback);

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
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
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
  const names = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  for (const name of names) {
    const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    database.sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
}

function isoWeekKey(milliseconds) {
  const date = new Date(milliseconds + 60 * 60 * 1_000);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function activeWATWeek(now = Date.now()) {
  const shifted = new Date(now + 60 * 60 * 1_000);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - ((shifted.getUTCDay() + 6) % 7));
  const effectiveFromMs = shifted.getTime() - 60 * 60 * 1_000;
  const expiresAtMs = effectiveFromMs + 7 * 86_400_000;
  const watString = (milliseconds) =>
    new Date(milliseconds + 60 * 60 * 1_000).toISOString().replace(/\.000Z$/, "+01:00");
  return {
    week: isoWeekKey(effectiveFromMs),
    effectiveFromMs,
    effectiveFromWat: watString(effectiveFromMs),
    expiresAtWat: watString(expiresAtMs),
  };
}

function makeRelease({
  revision = 1,
  releaseId = "release-current-r1",
  sponsor,
} = {}) {
  const schedule = activeWATWeek();
  const categories = ["Food", "Slang", "Music", "Culture", "Naija Life"];
  const partyCategories = [
    ["Celebrities", 47],
    ["Culture", 28],
    ["Diaspora", 27],
    ["Food", 34],
    ["Music", 53],
    ["Naija Life", 61],
    ["Religion", 18],
    ["School", 18],
    ["Slang", 54],
    ["Street & Hustle", 10],
  ].flatMap(([category, count]) => Array.from({ length: count }, () => category));
  const partyCards = partyCategories.map((category, index) => ({
    card_number: index + 1,
    id: `PARTY-${index + 1}`,
    difficulty: ["Easy", "Medium", "Hard"][index % 3],
    category,
    main_word: `Main Gist ${index + 1}`,
    forbidden_words: [
      `Forbidden A ${index + 1}`,
      `Forbidden B ${index + 1}`,
      `Forbidden C ${index + 1}`,
    ],
  }));
  const partyWordsByCategory = new Map();
  for (const card of partyCards) {
    const words = partyWordsByCategory.get(card.category) ?? [];
    words.push(card.main_word);
    partyWordsByCategory.set(card.category, words);
  }
  const questions = Array.from({ length: 35 }, (_, questionIndex) => {
    const number = questionIndex + 1;
    const id = `SG-REMOTE-${number}`;
    const category = categories[questionIndex % categories.length];
    const choices = partyWordsByCategory.get(category);
    return {
      id,
      category,
      answer_family: `remote-family-${number}`,
      clues: [
        `Staged opening clue ${number}`,
        `Sharper middle clue ${number}`,
        `Final decisive clue ${number}`,
      ],
      options: Array.from({ length: 7 }, (_, optionIndex) => ({
        id: `${id}-option-${optionIndex + 1}`,
        label: choices[(questionIndex * 7 + optionIndex) % choices.length],
        category,
        answer_family: `remote-family-${number}`,
      })),
      correct_option_id: `${id}-option-1`,
      explanation: `${choices[(questionIndex * 7) % choices.length]} is correct because this is a reviewed test fixture.`,
    };
  });
  const quickPlayIDs = questions.map((question) => question.id);
  const dailyPacks = Array.from({ length: 7 }, (_, dayIndex) => {
    const dateWat = new Date(
      schedule.effectiveFromMs + dayIndex * 86_400_000 + 60 * 60 * 1_000,
    )
      .toISOString()
      .slice(0, 10);
    return {
      date_wat: dateWat,
      question_ids: Array.from(
        { length: 5 },
        (_, offset) => quickPlayIDs[dayIndex * 5 + offset],
      ),
    };
  });

  return {
    schema_version: 1,
    release_id: releaseId,
    revision,
    effective_week_wat: schedule.week,
    effective_from_wat: schedule.effectiveFromWat,
    expires_at_wat: schedule.expiresAtWat,
    minimum_app_version: "1.0.0",
    ...(sponsor ? { sponsor } : {}),
    party_deck: {
      schema_version: 1,
      content_version: `party-r${revision}`,
      cards: partyCards,
    },
    solo_gist: {
      schema_version: 1,
      content_version: `solo-r${revision}`,
      effective_week_wat: schedule.week,
      questions,
      quick_play_question_ids: quickPlayIDs,
      daily_packs: dailyPacks,
    },
  };
}

function moveReleaseOneWeekLater(release) {
  const dayMs = 86_400_000;
  const nextStart = Date.parse(release.effective_from_wat) + 7 * dayMs;
  const nextEnd = nextStart + 7 * dayMs;
  const watString = (milliseconds) =>
    new Date(milliseconds + 60 * 60 * 1_000).toISOString().replace(/\.000Z$/, "+01:00");
  release.effective_from_wat = watString(nextStart);
  release.expires_at_wat = watString(nextEnd);
  release.effective_week_wat = isoWeekKey(nextStart);
  release.solo_gist.effective_week_wat = release.effective_week_wat;
  release.solo_gist.daily_packs.forEach((pack, index) => {
    pack.date_wat = new Date(nextStart + index * dayMs + 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
  });
  return release;
}

function request(worker, database, path, init = {}, environment = {}) {
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      WBD_CONTENT_ADMIN_USER_IDS: "owner-user-id",
      ...environment,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const ownerHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  "oai-authenticated-user-id": "owner-user-id",
  "oai-authenticated-user-email": "owner@example.com",
};

test("owner endpoints require same-origin JSON while bearer automation remains available", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const release = makeRelease();

  const session = await request(worker, database, "/api/v1/admin/content/session", {
    headers: {
      "oai-authenticated-user-id": "owner-user-id",
      "oai-authenticated-user-email": "owner@example.com",
    },
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authorized: true, method: "siwc" });

  const missingOrigin = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-authenticated-user-id": "owner-user-id",
        "oai-authenticated-user-email": "owner@example.com",
      },
      body: JSON.stringify(release),
    },
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).error.code, "content_admin_origin_invalid");

  const wrongType = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "text/plain" },
      body: JSON.stringify(release),
    },
  );
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).error.code, "content_type_invalid");

  const adminToken = "content-admin-test-token-1234567890";
  const bearer = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(release),
    },
    { WBD_CONTENT_ADMIN_TOKEN: adminToken },
  );
  assert.equal(bearer.status, 200);
});

test("owner validation and publishing produce hashed immutable public assets", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const release = makeRelease({
    sponsor: {
      kind: "commercial",
      sponsor_name: "Test Sponsor",
      message: "Supporting this week's reviewed fixture.",
      campaign_title: null,
      logo_url: null,
    },
  });

  const validateResponse = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(release) },
  );
  assert.equal(validateResponse.status, 200);
  const validation = await validateResponse.json();
  assert.equal(validation.valid, true);
  assert.match(validation.release.assets.party_deck.sha256, /^[a-f0-9]{64}$/);
  assert.equal(validation.release.assets.party_deck.item_count, 350);
  assert.equal(validation.release.assets.solo_gist.item_count, 35);

  const publishResponse = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/publish",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(release) },
  );
  assert.equal(publishResponse.status, 201);

  const manifestResponse = await request(
    worker,
    database,
    "/api/v1/content/manifest",
  );
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("cache-control"), "public, max-age=300, must-revalidate");
  const manifestEtag = manifestResponse.headers.get("etag");
  assert.ok(manifestEtag);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.revision, 1);
  assert.equal(manifest.effective_week_wat, release.effective_week_wat);
  assert.deepEqual(manifest.sponsor, release.sponsor);
  assert.deepEqual(validation.release.sponsor, release.sponsor);
  assert.match(manifest.effective_from_wat, /T00:00:00\+01:00$/);
  assert.doesNotMatch(JSON.stringify(Object.values(manifest.sponsor)), /url|action|league/i);
  assert.doesNotMatch(JSON.stringify(manifest), /correct_option|answer_family|league/i);

  const notModified = await request(worker, database, "/api/v1/content/manifest", {
    headers: { "if-none-match": manifestEtag },
  });
  assert.equal(notModified.status, 304);

  const partyURL = new URL(manifest.assets.party_deck.url);
  const partyResponse = await request(worker, database, partyURL.pathname);
  assert.equal(partyResponse.status, 200);
  assert.equal(
    partyResponse.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  const partyText = await partyResponse.text();
  assert.equal(createHash("sha256").update(partyText).digest("hex"), manifest.assets.party_deck.sha256);
  assert.equal(JSON.parse(partyText).cards.length, 350);

  const soloURL = new URL(manifest.assets.solo_gist.url);
  const soloResponse = await request(worker, database, soloURL.pathname);
  const soloText = await soloResponse.text();
  assert.equal(createHash("sha256").update(soloText).digest("hex"), manifest.assets.solo_gist.sha256);
  assert.match(soloText, /correct_option_id/);
  assert.doesNotMatch(soloText, /editorial|source_urls|competition|league_answer/i);
});

test("the owner catalog build succeeds once every option has independent family evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "wbd-content-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "next-week.json");

  await execFile(
      process.execPath,
      [
        "scripts/build-content-release.mjs",
        "--week", "next",
        "--revision", "98765",
        "--output", output,
      ],
      { cwd: process.cwd() },
    );
  const built = JSON.parse(await readFile(output, "utf8"));
  assert.ok(built.solo_gist.questions.length >= 35);
});

test("publishing is fail-closed and rejects content that fails Solo QC", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const release = makeRelease();

  const anonymous = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(release) },
  );
  assert.equal(anonymous.status, 401);

  const unapproved = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-authenticated-user-id": "someone-else",
        "oai-authenticated-user-email": "someone@example.com",
      },
      body: JSON.stringify(release),
    },
  );
  assert.equal(unapproved.status, 403);

  release.solo_gist.questions[0].clues[0] = release.solo_gist.questions[0].options[0].label;
  release.solo_gist.questions[1].options[2].answer_family = "wrong-family";
  release.solo_gist.questions[2].options[3].category = "Wrong Category";
  release.solo_gist.league_answer_key = { "GL-001": "secret" };
  release.party_deck.cards[0].category = "Food";
  release.solo_gist.questions[4].category = "food";
  for (const option of release.solo_gist.questions[4].options) option.category = "food";
  const invalid = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/publish",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(release) },
  );
  assert.equal(invalid.status, 422);
  const payload = await invalid.json();
  assert.ok(payload.issues.some((issue) => issue.includes("answer_leak")));
  assert.ok(payload.issues.some((issue) => issue.includes("answer_family:question_mismatch")));
  assert.ok(payload.issues.some((issue) => issue.includes("category:question_mismatch")));
  assert.ok(payload.issues.some((issue) => issue.includes("category_floor:celebrities")));
  assert.ok(payload.issues.some((issue) => issue.includes("category:canonical_value_required")));
  assert.ok(payload.issues.some((issue) => issue.includes("unknown_field:league_answer_key")));

  const manifest = await request(worker, database, "/api/v1/content/manifest");
  assert.equal(manifest.status, 404);
});

test("a Solo option cannot be relabelled into another Party category", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const release = makeRelease();

  // Question four is Culture. Keep its option metadata as Culture, but swap
  // in an actual Food label to simulate a tempting hand-edited bad distractor.
  release.solo_gist.questions[3].options[4].label = release.party_deck.cards
    .find((card) => card.category === "Food").main_word;

  const response = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(release) },
  );
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.ok(payload.issues.some((issue) => issue.includes("label:party_category_mismatch")));
});

test("a higher revision supersedes the week without breaking old immutable URLs", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const first = makeRelease();
  const second = makeRelease({ revision: 2, releaseId: "release-current-r2" });
  second.party_deck.cards[0].main_word = "Updated Main Gist";

  for (const release of [first, second]) {
    const response = await request(
      worker,
      database,
      "/api/v1/admin/content/releases/publish",
      { method: "POST", headers: ownerHeaders, body: JSON.stringify(release) },
    );
    assert.equal(response.status, 201);
  }

  const manifestResponse = await request(worker, database, "/api/v1/content/manifest");
  const manifest = await manifestResponse.json();
  assert.equal(manifest.revision, 2);

  const oldAsset = await request(
    worker,
    database,
    "/api/v1/content/assets/release-current-r1/party_deck",
  );
  assert.equal(oldAsset.status, 200);
  assert.equal(JSON.parse(await oldAsset.text()).cards[0].main_word, "Main Gist 1");
});

test("the next week cannot recycle Today’s 5 from the prior published release", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const first = makeRelease();
  const nextWeek = moveReleaseOneWeekLater(
    makeRelease({ revision: 2, releaseId: "release-next-week-r2" }),
  );

  const firstPublish = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/publish",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(first) },
  );
  assert.equal(firstPublish.status, 201);

  const validate = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/validate",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(nextWeek) },
  );
  assert.equal(validate.status, 409);
  const validationPayload = await validate.json();
  assert.equal(validationPayload.error.code, "daily_question_reuse");
  assert.equal(validationPayload.error.details.reused_question_count, 35);

  const publish = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/publish",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(nextWeek) },
  );
  assert.equal(publish.status, 409);
  assert.equal((await publish.json()).error.code, "daily_question_reuse");
});

test("future published assets stay embargoed until their WAT effective time", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const release = moveReleaseOneWeekLater(
    makeRelease({ revision: 9, releaseId: "future-release-r9" }),
  );
  const publish = await request(
    worker,
    database,
    "/api/v1/admin/content/releases/publish",
    { method: "POST", headers: ownerHeaders, body: JSON.stringify(release) },
  );
  assert.equal(publish.status, 201);

  const futureAsset = await request(
    worker,
    database,
    "/api/v1/content/assets/future-release-r9/party_deck",
  );
  assert.equal(futureAsset.status, 404);

  database.sqlite
    .prepare("UPDATE content_releases SET status = 'superseded' WHERE id = 'future-release-r9'")
    .run();
  const futureSupersededAsset = await request(
    worker,
    database,
    "/api/v1/content/assets/future-release-r9/party_deck",
  );
  assert.equal(futureSupersededAsset.status, 404);

  database.sqlite
    .prepare("UPDATE content_releases SET effective_from_ms = ? WHERE id = 'future-release-r9'")
    .run(Date.now() - 1_000);
  const activeAsset = await request(
    worker,
    database,
    "/api/v1/content/assets/future-release-r9/party_deck",
  );
  assert.equal(activeAsset.status, 200);
});

test("growing owner catalog blocks legacy short releases from being republished", async (t) => {
  const database = new TestD1Database();
  t.after(() => database.close());
  await migrate(database);
  const worker = await builtWorker();
  const catalog = JSON.parse(
    await readFile(new URL("../content/solo-gist-catalog.json", import.meta.url), "utf8"),
  );
  const currentSeed = JSON.parse(
    await readFile(new URL("../content/releases/2026-W35-r1.json", import.meta.url), "utf8"),
  );
  const nextTemplate = JSON.parse(
    await readFile(new URL("../content/templates/2026-W36-r2.json", import.meta.url), "utf8"),
  );

  const readyCards = catalog.cards.filter(
    (card) => card.final_qc === "READY" && card.family_review === "Pass",
  );
  const heldCards = catalog.cards.filter((card) => !readyCards.includes(card));
  // The weekly builder requires 35 distinct reviewed cards; this catalog is
  // allowed to grow without turning a content-test assertion into a release
  // blocker. Older, 26-card assets remain immutable historical artifacts, but
  // cannot be republished as a new daily release because they repeat cards.
  assert.ok(catalog.cards.length >= 35);
  assert.ok(readyCards.length >= 35);
  assert.ok(heldCards.length >= 1);

  for (const seed of [currentSeed, nextTemplate]) {
    const validateResponse = await request(
      worker,
      database,
      "/api/v1/admin/content/releases/validate",
      { method: "POST", headers: ownerHeaders, body: JSON.stringify(seed) },
    );
    assert.equal(validateResponse.status, 422);
    const validation = await validateResponse.json();
    assert.equal(validation.valid, false);
    assert.ok(
      validation.issues.some((issue) => issue.includes("solo_gist.questions:count:26/35-1000")),
    );
    assert.equal(seed.party_deck.cards.length, 350);
    assert.equal(seed.solo_gist.questions.length, 26);
    assert.equal(seed.solo_gist.quick_play_question_ids.length, 26);
    assert.ok(
      seed.solo_gist.questions.filter(
        (question) => !new Set(["Food", "Naija Life", "Slang"]).has(question.category),
      ).length >= 10,
    );
    assert.ok(
      seed.solo_gist.questions.every((question) =>
        question.options.every(
          (option) =>
            option.category === question.category
            && option.answer_family === question.answer_family,
        )),
    );
  }
});
