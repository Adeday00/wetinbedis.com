import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

class D1Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.db, this.sql, values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
}

class D1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) { this.sqlite.exec("BEGIN IMMEDIATE"); try { const result = []; for (const statement of statements) result.push(await statement.run()); this.sqlite.exec("COMMIT"); return result; } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; } }
  close() { this.sqlite.close(); }
}

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function migrate(db) {
  for (const name of ["0000_brainy_giant_girl.sql", "0001_silly_northstar.sql", "0002_nice_shiva.sql", "0003_mysterious_smasher.sql", "0004_loving_aqueduct.sql", "0005_chunky_cardiac.sql", "0007_wakeful_toxin.sql", "0008_content_release_audit.sql", "0009_cash_operations.sql", "0010_party_deck_editor.sql", "0011_google_play_entitlements.sql", "0012_google_review_access.sql", "0013_firebase_league_profiles.sql", "0014_username_registry.sql", "0015_apple_app_attest.sql", "0016_player_eligibility_reviews.sql", "0017_privacy_requests.sql", "0018_cash_launch_gates.sql", "0019_competition_eligible_countries.sql", "0020_competition_eligibility_policy_audit.sql", "0021_competition_payouts_ngn.sql", "0022_cash_launch_gate_audit.sql", "0023_payout_details_vault.sql", "0024_rehearsal_payout_previews.sql", "0025_sponsor_spotlight_fields.sql", "0026_admin_audit_log.sql", "0027_admin_roles.sql"]) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    db.sqlite.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
}

function config(revision) {
  return {
    schema_version: 1,
    revision,
    published_at: new Date(Date.now() - 1_000).toISOString(),
    cache_ttl_seconds: 900,
    home: { show_todays_five: true, show_gather_people: true, show_sharp_sharp: false, event_banner: null },
    categories: [],
    events: { odogwu_league: { enabled: true, visible_from: null, starts_at: null, ends_at: null, mode: "practice", home_placement: "banner", headline: "Practice League", rules_url: null, content_release_id: null, cash_enabled: false } },
  };
}

async function call(api, db, path, init = {}) {
  return api.fetch(new Request(`http://localhost${path}`, init), { DB: db, WBD_CONTENT_ADMIN_TOKEN: "owner-token-with-enough-length", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } });
}

test("app-config owner lifecycle publishes and serves only the active revision", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const api = await worker();
    const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
    const draft = await call(api, db, "/api/v1/admin/app-config/draft", { method: "POST", headers, body: JSON.stringify({ config: config(1), reason: "prepare practice event" }) });
    assert.equal(draft.status, 201);
    const review = await call(api, db, "/api/v1/admin/app-config/review", { method: "POST", headers, body: JSON.stringify({ revision: 1, reason: "operations review complete" }) });
    assert.equal(review.status, 200);
    const publish = await call(api, db, "/api/v1/admin/app-config/publish", { method: "POST", headers, body: JSON.stringify({ revision: 1, reason: "publish reviewed practice event" }) });
    assert.equal(publish.status, 200);
    const publicResponse = await call(api, db, "/api/v1/app-config");
    assert.equal(publicResponse.status, 200);
    const body = await publicResponse.json();
    assert.equal(body.revision, 1);
    assert.equal(body.events.odogwu_league.cash_enabled, false);
  } finally { db.close(); }
});

test("public app config removes a stale live timer when no backing round exists", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const api = await worker();
    const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
    const live = config(2);
    live.published_at = new Date().toISOString();
    live.events.odogwu_league.starts_at = new Date(Date.now() - 60_000).toISOString();
    live.events.odogwu_league.visible_from = live.events.odogwu_league.starts_at;
    live.events.odogwu_league.ends_at = new Date(Date.now() + 3_600_000).toISOString();
    const draft = await call(api, db, "/api/v1/admin/app-config/draft", { method: "POST", headers, body: JSON.stringify({ config: live, reason: "verify live config backing guard" }) });
    assert.equal(draft.status, 201);
    assert.equal((await call(api, db, "/api/v1/admin/app-config/review", { method: "POST", headers, body: JSON.stringify({ revision: 2, reason: "review backing guard" }) })).status, 200);
    assert.equal((await call(api, db, "/api/v1/admin/app-config/publish", { method: "POST", headers, body: JSON.stringify({ revision: 2, reason: "publish backing guard" }) })).status, 200);
    const publicResponse = await call(api, db, "/api/v1/app-config");
    const body = await publicResponse.json();
    assert.equal(body.events.odogwu_league.enabled, true);
    assert.equal(body.events.odogwu_league.home_placement, "banner");
    assert.equal(body.events.odogwu_league.starts_at, null);
  } finally { db.close(); }
});

test("public app config does not show a stale future Odogwu countdown", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const api = await worker();
    const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
    const scheduled = config(3);
    scheduled.events.odogwu_league.starts_at = new Date(Date.now() + 60_000).toISOString();
    scheduled.events.odogwu_league.ends_at = new Date(Date.now() + 3_600_000).toISOString();
    const draft = await call(api, db, "/api/v1/admin/app-config/draft", { method: "POST", headers, body: JSON.stringify({ config: scheduled, reason: "verify stale schedule guard" }) });
    assert.equal(draft.status, 201);
    assert.equal((await call(api, db, "/api/v1/admin/app-config/review", { method: "POST", headers, body: JSON.stringify({ revision: 3, reason: "review stale schedule guard" }) })).status, 200);
    assert.equal((await call(api, db, "/api/v1/admin/app-config/publish", { method: "POST", headers, body: JSON.stringify({ revision: 3, reason: "publish stale schedule guard" }) })).status, 200);
    const body = await (await call(api, db, "/api/v1/app-config")).json();
    assert.equal(body.events.odogwu_league.enabled, true);
    assert.equal(body.events.odogwu_league.starts_at, null);
  } finally { db.close(); }
});

test("repeating the same owner draft is idempotent without duplicating audit history", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const api = await worker();
    const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
    const body = JSON.stringify({ config: config(7), reason: "prepare rehearsal event" });
    const first = await call(api, db, "/api/v1/admin/app-config/draft", { method: "POST", headers, body });
    const second = await call(api, db, "/api/v1/admin/app-config/draft", { method: "POST", headers, body });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).already_exists, true);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM app_config_revisions WHERE revision = 7").get().count, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM app_config_audit WHERE revision_id = 'app-config-7'").get().count, 1);
  } finally { db.close(); }
});

test("app-config emergency disable fails closed to safe defaults", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const api = await worker();
    const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
    const publish = await call(api, db, "/api/v1/admin/app-config/publish", { method: "POST", headers, body: JSON.stringify({ config: config(2), reason: "publish practice event" }) });
    assert.equal(publish.status, 201);
    const disable = await call(api, db, "/api/v1/admin/app-config/disable", { method: "POST", headers, body: JSON.stringify({ reason: "incident pause" }) });
    assert.equal(disable.status, 200);
    const publicResponse = await call(api, db, "/api/v1/app-config");
    assert.equal(publicResponse.status, 200);
    const body = await publicResponse.json();
    assert.equal(body.revision, 0);
    assert.equal(body.events.odogwu_league.enabled, false);
    assert.equal(body.events.odogwu_league.cash_enabled, false);
  } finally { db.close(); }
});

test("league start announcements require the published Odogwu banner", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const api = await worker();
    const headers = { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" };
    const disabled = config(3);
    disabled.events.odogwu_league.enabled = false;
    disabled.events.odogwu_league.home_placement = "none";
    const publish = await call(api, db, "/api/v1/admin/app-config/publish", {
      method: "POST",
      headers,
      body: JSON.stringify({ config: disabled, reason: "verify banner launch safety" }),
    });
    assert.equal(publish.status, 201);

    const announcement = await call(api, db, "/api/v1/admin/notifications/league-broadcast", {
      method: "POST",
      headers,
      body: JSON.stringify({ event: "started", title: "Odogwu League", body: "The league is live." }),
    });
    assert.equal(announcement.status, 409);
    const body = await announcement.json();
    assert.equal(body.error.code, "odogwu_banner_required");
  } finally { db.close(); }
});

test("cash launch-gate decisions require evidence and retain an immutable audit history", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const api = await worker();
    const headers = {
      authorization: "Bearer owner-token-with-enough-length",
      "content-type": "application/json",
    };
    const missingEvidence = await call(
      api,
      db,
      "/api/v1/admin/cash/launch-gates/payout_operations_and_funding",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          status: "passed",
          note: "A pass must never be accepted without restricted evidence.",
        }),
      },
    );
    assert.equal(missingEvidence.status, 400);
    assert.equal((await missingEvidence.json()).error.code, "cash_launch_gate_evidence_required");

    const passed = await call(
      api,
      db,
      "/api/v1/admin/cash/launch-gates/payout_operations_and_funding",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          status: "passed",
          evidence_reference: "restricted-launch-evidence/ngn-payout-drill-2026-11",
          note: "NGN funding, dual control, and reconciliation drill completed.",
        }),
      },
    );
    assert.equal(passed.status, 200);

    const reverted = await call(
      api,
      db,
      "/api/v1/admin/cash/launch-gates/payout_operations_and_funding",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          status: "pending",
          note: "Provider settlement confirmation must be renewed before launch.",
        }),
      },
    );
    assert.equal(reverted.status, 200);

    const status = await call(api, db, "/api/v1/admin/cash/launch-gates", { headers });
    assert.equal(status.status, 200);
    const body = await status.json();
    const gate = body.gates.find((item) => item.gate_key === "payout_operations_and_funding");
    assert.equal(gate.status, "pending");
    const history = body.audit.filter((item) => item.gate_key === "payout_operations_and_funding");
    assert.equal(history.length, 2);
    assert.ok(history.some((item) => item.status === "pending"));
    assert.ok(history.some((item) =>
      item.status === "passed"
      && item.evidence_reference === "restricted-launch-evidence/ngn-payout-drill-2026-11",
    ));
  } finally { db.close(); }
});

test("content release revoke is authenticated and audited", async () => {
  const db = new D1();
  try {
    await migrate(db);
    const now = Date.now();
    db.sqlite.prepare(`INSERT INTO content_releases (id, revision, schema_version, status, effective_week_wat, effective_from_ms, expires_at_ms, minimum_app_version, published_by, published_at, created_at) VALUES (?, 4, 1, 'published', '2026-W40', ?, ?, '1.0.0', 'owner', ?, ?)`).run("release-to-revoke", now - 60_000, now + 60_000, now, now);
    const api = await worker();
    const response = await call(api, db, "/api/v1/admin/content/releases/revoke", { method: "POST", headers: { authorization: "Bearer owner-token-with-enough-length", "content-type": "application/json" }, body: JSON.stringify({ release_id: "release-to-revoke", reason: "content incident" }) });
    assert.equal(response.status, 200);
    assert.equal(db.sqlite.prepare("SELECT status FROM content_releases WHERE id = ?").get("release-to-revoke").status, "revoked");
    assert.equal(db.sqlite.prepare("SELECT action FROM content_release_audit WHERE release_id = ?").get("release-to-revoke").action, "revoke");
  } finally { db.close(); }
});
