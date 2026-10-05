export const APP_CONFIG_SCHEMA_VERSION = 1;

export type AppConfigAccess = "free" | "full_gist" | "featured" | "temporary_unlock";
export type AppConfigEventMode = "practice" | "cash_ready";

export type AppConfigDocument = {
  schema_version: 1;
  revision: number;
  published_at: string;
  cache_ttl_seconds: number;
  home: {
    show_todays_five: boolean;
    show_gather_people: boolean;
    show_sharp_sharp: boolean;
    event_banner: {
      event_id: string;
      headline: string;
      artwork_url: string | null;
      starts_at: string;
      ends_at: string;
    } | null;
  };
  categories: Array<{
    id: string;
    display_name: string;
    enabled: boolean;
    access: AppConfigAccess;
    content_release_id: string;
    style_key: string;
    starts_at: string | null;
    ends_at: string | null;
  }>;
  events: {
    odogwu_league: {
      enabled: boolean;
      visible_from: string | null;
      starts_at: string | null;
      ends_at: string | null;
      mode: AppConfigEventMode;
      home_placement: "none" | "banner" | "card";
      headline: string | null;
      rules_url: string | null;
      content_release_id: string | null;
      cash_enabled: false;
    };
  };
};

const ACCESS_VALUES = new Set<AppConfigAccess>([
  "free",
  "full_gist",
  "featured",
  "temporary_unlock",
]);
const EVENT_PLACEMENTS = new Set(["none", "banner", "card"]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ID = /^[a-z0-9][a-z0-9._-]{1,95}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, path: string, issues: string[], max = 160): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    issues.push(`${path}:must_be_non_empty_string`);
    return null;
  }
  return value.trim();
}

function nullableISO(value: unknown, path: string, issues: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !ISO.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push(`${path}:must_be_iso_8601_utc_or_null`);
    return null;
  }
  return value;
}

function secureURL(value: unknown, path: string, issues: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    issues.push(`${path}:must_be_https_url_or_null`);
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("not https");
    return url.href;
  } catch {
    issues.push(`${path}:must_be_https_url_or_null`);
    return null;
  }
}

function orderedWindow(start: string | null, end: string | null, path: string, issues: string[]): void {
  if (start && end && Date.parse(end) <= Date.parse(start)) issues.push(`${path}:end_must_follow_start`);
}

export function validateAppConfig(input: unknown, now = Date.now()): { config?: AppConfigDocument; issues: string[] } {
  const issues: string[] = [];
  if (!isRecord(input)) return { issues: ["config:must_be_object"] };
  if (input.schema_version !== APP_CONFIG_SCHEMA_VERSION) issues.push("schema_version:unsupported");
  if (!Number.isInteger(input.revision) || Number(input.revision) < 1) issues.push("revision:must_be_positive_integer");
  const publishedAt = nullableISO(input.published_at, "published_at", issues);
  if (publishedAt && Date.parse(publishedAt) > now + 5 * 60_000) issues.push("published_at:cannot_be_far_in_future");
  if (!Number.isInteger(input.cache_ttl_seconds) || Number(input.cache_ttl_seconds) < 60 || Number(input.cache_ttl_seconds) > 86400) {
    issues.push("cache_ttl_seconds:must_be_between_60_and_86400");
  }

  const home = isRecord(input.home) ? input.home : null;
  if (!home) issues.push("home:must_be_object");
  const banner = home && home.event_banner !== null && home.event_banner !== undefined
    ? (isRecord(home.event_banner) ? home.event_banner : null) : null;
  if (home?.event_banner !== null && home?.event_banner !== undefined && !banner) issues.push("home.event_banner:must_be_object_or_null");
  const bannerStart = banner ? nullableISO(banner.starts_at, "home.event_banner.starts_at", issues) : null;
  const bannerEnd = banner ? nullableISO(banner.ends_at, "home.event_banner.ends_at", issues) : null;
  orderedWindow(bannerStart, bannerEnd, "home.event_banner", issues);
  if (banner) {
    requiredString(banner.event_id, "home.event_banner.event_id", issues, 96);
    requiredString(banner.headline, "home.event_banner.headline", issues, 140);
    secureURL(banner.artwork_url, "home.event_banner.artwork_url", issues);
  }

  const rawCategories = Array.isArray(input.categories) ? input.categories : [];
  if (!Array.isArray(input.categories)) issues.push("categories:must_be_array");
  const categoryIDs = new Set<string>();
  const categories = rawCategories.map((raw, index) => {
    const path = `categories[${index}]`;
    if (!isRecord(raw)) { issues.push(`${path}:must_be_object`); return null; }
    const id = requiredString(raw.id, `${path}.id`, issues, 96) ?? "invalid";
    if (!ID.test(id)) issues.push(`${path}.id:invalid_id`);
    if (categoryIDs.has(id)) issues.push(`${path}.id:duplicate`);
    categoryIDs.add(id);
    const displayName = requiredString(raw.display_name, `${path}.display_name`, issues, 80) ?? "";
    const access = raw.access;
    if (typeof access !== "string" || !ACCESS_VALUES.has(access as AppConfigAccess)) issues.push(`${path}.access:invalid`);
    const starts = nullableISO(raw.starts_at, `${path}.starts_at`, issues);
    const ends = nullableISO(raw.ends_at, `${path}.ends_at`, issues);
    orderedWindow(starts, ends, path, issues);
    const release = requiredString(raw.content_release_id, `${path}.content_release_id`, issues, 128) ?? "";
    const style = requiredString(raw.style_key, `${path}.style_key`, issues, 96) ?? "generic_premium";
    return { id, display_name: displayName, enabled: raw.enabled === true, access: (ACCESS_VALUES.has(access as AppConfigAccess) ? access : "free") as AppConfigAccess, content_release_id: release, style_key: style, starts_at: starts, ends_at: ends };
  }).filter((value): value is NonNullable<typeof value> => value !== null);

  const events = isRecord(input.events) ? input.events : null;
  const league = events && isRecord(events.odogwu_league) ? events.odogwu_league : null;
  if (!league) issues.push("events.odogwu_league:must_be_object");
  const visible = league ? nullableISO(league.visible_from, "events.odogwu_league.visible_from", issues) : null;
  const starts = league ? nullableISO(league.starts_at, "events.odogwu_league.starts_at", issues) : null;
  const ends = league ? nullableISO(league.ends_at, "events.odogwu_league.ends_at", issues) : null;
  orderedWindow(starts, ends, "events.odogwu_league", issues);
  if (league && league.cash_enabled !== false) issues.push("events.odogwu_league.cash_enabled:must_remain_false_until_all_server_gates_exist");
  if (league && league.mode !== "practice" && league.mode !== "cash_ready") issues.push("events.odogwu_league.mode:invalid");
  if (league && !EVENT_PLACEMENTS.has(String(league.home_placement))) issues.push("events.odogwu_league.home_placement:invalid");
  const config: AppConfigDocument = {
    schema_version: 1,
    revision: Number(input.revision),
    published_at: publishedAt ?? new Date(now).toISOString(),
    cache_ttl_seconds: Number(input.cache_ttl_seconds),
    home: {
      show_todays_five: home?.show_todays_five === true,
      show_gather_people: home?.show_gather_people === true,
      show_sharp_sharp: home?.show_sharp_sharp === true,
      event_banner: banner ? { event_id: String(banner.event_id ?? ""), headline: String(banner.headline ?? ""), artwork_url: secureURL(banner.artwork_url, "home.event_banner.artwork_url", []), starts_at: bannerStart ?? "", ends_at: bannerEnd ?? "" } : null,
    },
    categories,
    events: { odogwu_league: { enabled: league?.enabled === true, visible_from: visible, starts_at: starts, ends_at: ends, mode: league?.mode === "cash_ready" ? "cash_ready" : "practice", home_placement: EVENT_PLACEMENTS.has(String(league?.home_placement)) ? league?.home_placement as "none" | "banner" | "card" : "none", headline: league?.headline === null || league?.headline === undefined ? null : String(league.headline), rules_url: secureURL(league?.rules_url, "events.odogwu_league.rules_url", issues), content_release_id: league?.content_release_id === null || league?.content_release_id === undefined ? null : String(league.content_release_id), cash_enabled: false } },
  };
  return issues.length ? { issues } : { config, issues: [] };
}

export function safeDefaultAppConfig(now = Date.now()): AppConfigDocument {
  return { schema_version: 1, revision: 0, published_at: new Date(now).toISOString(), cache_ttl_seconds: 900, home: { show_todays_five: true, show_gather_people: true, show_sharp_sharp: false, event_banner: null }, categories: [], events: { odogwu_league: { enabled: false, visible_from: null, starts_at: null, ends_at: null, mode: "practice", home_placement: "none", headline: null, rules_url: null, content_release_id: null, cash_enabled: false } } };
}
