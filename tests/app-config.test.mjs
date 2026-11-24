import assert from "node:assert/strict";
import test from "node:test";
import { safeDefaultAppConfig, validateAppConfig } from "../worker/api/app-config.ts";
import { resolveLeagueSchedule } from "../worker/api/league-schedule.ts";

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
  assert.equal(result.config.setup.default_category, "Food");
});

test("remote setup can choose an enabled category and rejects a disabled one", () => {
  const value = validConfig();
  value.setup = { default_category: "Owambe Edition" };
  const accepted = validateAppConfig(value, Date.parse("2026-09-30T12:00:00.000Z"));
  assert.deepEqual(accepted.issues, []);
  assert.equal(accepted.config.setup.default_category, "Owambe Edition");
  value.categories[0].enabled = false;
  const rejected = validateAppConfig(value, Date.parse("2026-09-30T12:00:00.000Z"));
  assert.ok(rejected.issues.includes("setup.default_category:must_be_available_category"));
});

test("app config permits an explicit cash request but still rejects insecure URLs", () => {
  const value = validConfig();
  value.events.odogwu_league.cash_enabled = true;
  value.events.odogwu_league.rules_url = "http://example.com/rules";
  const result = validateAppConfig(value, Date.parse("2026-09-30T12:00:00.000Z"));
  assert.equal(result.config, undefined);
  assert.ok(result.issues.includes("events.odogwu_league.rules_url:must_be_https_url_or_null"));
});

test("app config preserves an explicit cash request for Worker-side launch-gate enforcement", () => {
  const value = validConfig();
  value.events.odogwu_league.cash_enabled = true;
  const result = validateAppConfig(value, Date.parse("2026-09-30T12:00:00.000Z"));
  assert.deepEqual(result.issues, []);
  assert.equal(result.config.events.odogwu_league.cash_enabled, true);
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

test("weekly League schedule exposes the first Wednesday opening and Sunday close", () => {
  const value = validConfig();
  value.events.odogwu_league.weekly_schedule = {
    timezone: "Africa/Lagos",
    first_open_at: "2026-11-11T18:00:00.000Z",
    open_weekday: 3,
    open_time_local: "19:00",
    close_weekday: 0,
    close_time_local: "23:59",
  };
  const result = validateAppConfig(value, Date.parse("2026-10-08T12:00:00.000Z"));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.config.events.odogwu_league.weekly_schedule, value.events.odogwu_league.weekly_schedule);

  const beforeOpening = resolveLeagueSchedule(value.events.odogwu_league.weekly_schedule, Date.parse("2026-11-10T12:00:00.000Z"));
  assert.equal(beforeOpening.is_open, false);
  assert.equal(beforeOpening.next_open_at, "2026-11-11T18:00:00.000Z");

  const duringLeague = resolveLeagueSchedule(value.events.odogwu_league.weekly_schedule, Date.parse("2026-11-12T12:00:00.000Z"));
  assert.equal(duringLeague.is_open, true);
  assert.equal(duringLeague.current_close_at, "2026-11-15T22:59:00.000Z");
});
