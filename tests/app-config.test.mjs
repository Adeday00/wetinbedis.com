import assert from "node:assert/strict";
import test from "node:test";
import { safeDefaultAppConfig, validateAppConfig } from "../worker/api/app-config.ts";

function validConfig() {
  return {
    schema_version: 1,
    revision: 1,
    published_at: "2026-09-30T12:00:00.000Z",
    cache_ttl_seconds: 900,
    home: {
      show_todays_five: true,
      show_gather_people: true,
      show_sharp_sharp: false,
      event_banner: null,
    },
    categories: [{
      id: "owambe",
      display_name: "Owambe Edition",
      enabled: true,
      access: "full_gist",
      content_release_id: "2026-owambe-v1",
      style_key: "generic_premium",
      starts_at: null,
      ends_at: null,
    }],
    events: { odogwu_league: {
      enabled: true,
      visible_from: "2026-10-01T10:00:00.000Z",
      starts_at: "2026-10-02T10:00:00.000Z",
      ends_at: "2026-10-09T10:00:00.000Z",
      mode: "practice",
      home_placement: "banner",
      headline: "Practice League",
      rules_url: null,
      content_release_id: "2026-league-v1",
      cash_enabled: false,
    } },
  };
}

test("app config accepts safe practice configuration", () => {
  const result = validateAppConfig(validConfig(), Date.parse("2026-09-30T12:00:00.000Z"));
  assert.deepEqual(result.issues, []);
  assert.equal(result.config.events.odogwu_league.cash_enabled, false);
});

test("app config rejects cash enablement and insecure URLs", () => {
  const value = validConfig();
  value.events.odogwu_league.cash_enabled = true;
  value.events.odogwu_league.rules_url = "http://example.com/rules";
  const result = validateAppConfig(value, Date.parse("2026-09-30T12:00:00.000Z"));
  assert.ok(result.issues.includes("events.odogwu_league.cash_enabled:must_remain_false_until_all_server_gates_exist"));
  assert.ok(result.issues.includes("events.odogwu_league.rules_url:must_be_https_url_or_null"));
});

test("cash-ready is an explicit server state but remains non-payable", () => {
  const value = validConfig();
  value.events.odogwu_league.mode = "cash_ready";
  const result = validateAppConfig(value, Date.parse("2026-09-30T12:00:00.000Z"));
  assert.deepEqual(result.issues, []);
  assert.equal(result.config.events.odogwu_league.cash_enabled, false);
});

test("safe defaults hide League and paid placement", () => {
  const config = safeDefaultAppConfig(0);
  assert.equal(config.revision, 0);
  assert.equal(config.events.odogwu_league.enabled, false);
  assert.equal(config.events.odogwu_league.cash_enabled, false);
  assert.equal(config.home.event_banner, null);
});
