export const APP_CONFIG_SCHEMA_VERSION = 1;

export type AppConfigAccess = "free" | "full_gist" | "featured" | "temporary_unlock";
export type AppConfigEventMode = "practice" | "cash_ready";
export type WeeklyLeagueSchedule = {
  timezone: "Africa/Lagos";
  first_open_at: string;
  open_weekday: number;
  open_time_local: string;
  close_weekday: number;
  close_time_local: string;
};

export type HomeAnnouncement = {
  id: string;
  enabled: boolean;
  headline: string;
  message: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type AppBranding = {
  logo_url: string | null;
  theme_key: "owambe" | "lagos_night" | "market_day";
  card_display: "classic" | "editorial" | "bold";
};

export type AppConfigDocument = {
  schema_version: 1;
  revision: number;
  published_at: string;
  cache_ttl_seconds: number;
  setup: { default_category: string };
  branding: AppBranding;
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
    announcement: HomeAnnouncement | null;
  };
  categories: Array<{
    id: string;
    display_name: string;
    enabled: boolean;
    access: AppConfigAccess;
    content_release_id: string;
    style_key: string;
    icon_url: string | null;
    display_order: number;
    starts_at: string | null;
    ends_at: string | null;
  }>;
  events: {
    odogwu_league: {
      /** Emergency kill switch: removes the League surface and blocks entry. */
      enabled: boolean;
      /** Seasonal entry control: keeps prior standings visible while closed. */
      entry_enabled: boolean;
      visible_from: string | null;
      /** Optional operator-controlled time at which the player-facing banner is hidden. */
      banner_ends_at: string | null;
      show_last_leaderboard?: boolean;
      starts_at: string | null;
      ends_at: string | null;
      mode: AppConfigEventMode;
      home_placement: "none" | "banner" | "card";
      headline: string | null;
      rules_url: string | null;
      content_release_id: string | null;
      /** Display/entry switch; the Worker independently checks launch gates. */
      cash_enabled: boolean;
      weekly_schedule: WeeklyLeagueSchedule | null;
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
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9][a-z0-9._-]{1,95}$/;
const BUILT_IN_CATEGORIES = new Set([
  "Celebrities", "Culture", "Nollywood", "Celebrations", "Trending Now", "Food",
  "Music", "Naija Life", "Diaspora", "Slang", "Religion", "School",
]);
const THEME_KEYS = new Set<AppBranding["theme_key"]>(["owambe", "lagos_night", "market_day"]);
const CARD_DISPLAYS = new Set<AppBranding["card_display"]>(["classic", "editorial", "bold"]);
const CATEGORY_STYLE_KEYS = new Set([
  "generic_premium", "music", "celebrities", "naija_life", "slang", "food",
  "nollywood", "celebrations", "trending_now", "culture", "religion", "school", "diaspora",
]);

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
  const announcement = home && home.announcement !== null && home.announcement !== undefined
    ? (isRecord(home.announcement) ? home.announcement : null) : null;
  if (home?.announcement !== null && home?.announcement !== undefined && !announcement) {
    issues.push("home.announcement:must_be_object_or_null");
  }
  let validatedAnnouncement: HomeAnnouncement | null = null;
  if (announcement) {
    const id = requiredString(announcement.id, "home.announcement.id", issues, 96) ?? "";
    if (!ID.test(id)) issues.push("home.announcement.id:invalid_id");
    if (typeof announcement.enabled !== "boolean") issues.push("home.announcement.enabled:must_be_boolean");
    const headline = requiredString(announcement.headline, "home.announcement.headline", issues, 140) ?? "";
    const message = requiredString(announcement.message, "home.announcement.message", issues, 500) ?? "";
    const announcementStarts = nullableISO(announcement.starts_at, "home.announcement.starts_at", issues);
    const announcementEnds = nullableISO(announcement.ends_at, "home.announcement.ends_at", issues);
    orderedWindow(announcementStarts, announcementEnds, "home.announcement", issues);
    if (announcement.enabled === true && !announcementStarts) {
      issues.push("home.announcement.starts_at:required_when_enabled");
    }
    validatedAnnouncement = {
      id,
      enabled: announcement.enabled === true,
      headline,
      message,
      starts_at: announcementStarts,
      ends_at: announcementEnds,
    };
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
    if (!CATEGORY_STYLE_KEYS.has(style)) issues.push(`${path}.style_key:unsupported`);
    const iconURL = secureURL(raw.icon_url, `${path}.icon_url`, issues);
    const displayOrder = raw.display_order === undefined ? index : raw.display_order;
    if (!Number.isInteger(displayOrder) || Number(displayOrder) < 0 || Number(displayOrder) > 500) issues.push(`${path}.display_order:must_be_integer_0_to_500`);
    return { id, display_name: displayName, enabled: raw.enabled === true, access: (ACCESS_VALUES.has(access as AppConfigAccess) ? access : "free") as AppConfigAccess, content_release_id: release, style_key: CATEGORY_STYLE_KEYS.has(style) ? style : "generic_premium", icon_url: iconURL, display_order: Number.isInteger(displayOrder) ? Number(displayOrder) : index, starts_at: starts, ends_at: ends };
  }).filter((value): value is NonNullable<typeof value> => value !== null);

  const branding = input.branding === undefined ? {} : isRecord(input.branding) ? input.branding : null;
  if (input.branding !== undefined && !branding) issues.push("branding:must_be_object");
  const logoURL = secureURL(branding?.logo_url, "branding.logo_url", issues);
  const themeKey = branding?.theme_key === undefined ? "owambe" : branding.theme_key;
  if (typeof themeKey !== "string" || !THEME_KEYS.has(themeKey as AppBranding["theme_key"])) issues.push("branding.theme_key:unsupported");
  const cardDisplay = branding?.card_display === undefined ? "classic" : branding.card_display;
  if (typeof cardDisplay !== "string" || !CARD_DISPLAYS.has(cardDisplay as AppBranding["card_display"])) issues.push("branding.card_display:unsupported");

  const setup = input.setup === undefined ? null : isRecord(input.setup) ? input.setup : null;
  if (input.setup !== undefined && !setup) issues.push("setup:must_be_object");
  const defaultCategory = setup?.default_category === undefined ? "Food" : setup.default_category;
  const managedDefault = categories.find((item) => item.display_name === defaultCategory);
  const availableCategory = typeof defaultCategory === "string" && (
    managedDefault ? managedDefault.enabled : BUILT_IN_CATEGORIES.has(defaultCategory)
  );
  if (!availableCategory) issues.push("setup.default_category:must_be_available_category");

  const events = isRecord(input.events) ? input.events : null;
  const league = events && isRecord(events.odogwu_league) ? events.odogwu_league : null;
  if (!league) issues.push("events.odogwu_league:must_be_object");
  const visible = league ? nullableISO(league.visible_from, "events.odogwu_league.visible_from", issues) : null;
  const bannerEnds = league ? nullableISO(league.banner_ends_at, "events.odogwu_league.banner_ends_at", issues) : null;
  const starts = league ? nullableISO(league.starts_at, "events.odogwu_league.starts_at", issues) : null;
  const ends = league ? nullableISO(league.ends_at, "events.odogwu_league.ends_at", issues) : null;
  orderedWindow(starts, ends, "events.odogwu_league", issues);
  const weeklySchedule = league?.weekly_schedule === null || league?.weekly_schedule === undefined
    ? null
    : isRecord(league.weekly_schedule) ? league.weekly_schedule : null;
  if (league?.weekly_schedule !== null && league?.weekly_schedule !== undefined && !weeklySchedule) {
    issues.push("events.odogwu_league.weekly_schedule:must_be_object_or_null");
  }
  const scheduleFirstOpen = weeklySchedule
    ? nullableISO(weeklySchedule.first_open_at, "events.odogwu_league.weekly_schedule.first_open_at", issues)
    : null;
  const scheduleTimezone = weeklySchedule?.timezone;
  if (weeklySchedule && scheduleTimezone !== "Africa/Lagos") {
    issues.push("events.odogwu_league.weekly_schedule.timezone:must_be_Africa_Lagos");
  }
  for (const [key, path] of [
    ["open_weekday", "events.odogwu_league.weekly_schedule.open_weekday"],
    ["close_weekday", "events.odogwu_league.weekly_schedule.close_weekday"],
  ] as const) {
    const value = weeklySchedule?.[key];
    if (weeklySchedule && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 6)) {
      issues.push(`${path}:must_be_weekday_0_to_6`);
    }
  }
  for (const [key, path] of [
    ["open_time_local", "events.odogwu_league.weekly_schedule.open_time_local"],
    ["close_time_local", "events.odogwu_league.weekly_schedule.close_time_local"],
  ] as const) {
    const value = weeklySchedule?.[key];
    if (weeklySchedule && (typeof value !== "string" || !LOCAL_TIME.test(value))) {
      issues.push(`${path}:must_be_hh_mm`);
    }
  }
  if (weeklySchedule && scheduleFirstOpen && Date.parse(scheduleFirstOpen) < Date.parse("2026-01-01T00:00:00.000Z")) {
    issues.push("events.odogwu_league.weekly_schedule.first_open_at:must_be_current_schedule");
  }
  if (league && typeof league.enabled !== "boolean") issues.push("events.odogwu_league.enabled:must_be_boolean");
  if (league && league.entry_enabled !== undefined && typeof league.entry_enabled !== "boolean") issues.push("events.odogwu_league.entry_enabled:must_be_boolean");
  if (league && typeof league.cash_enabled !== "boolean") issues.push("events.odogwu_league.cash_enabled:must_be_boolean");
  if (league && league.mode !== "practice" && league.mode !== "cash_ready") issues.push("events.odogwu_league.mode:invalid");
  if (league && !EVENT_PLACEMENTS.has(String(league.home_placement))) issues.push("events.odogwu_league.home_placement:invalid");
  const config: AppConfigDocument = {
    schema_version: 1,
    revision: Number(input.revision),
    published_at: publishedAt ?? new Date(now).toISOString(),
    cache_ttl_seconds: Number(input.cache_ttl_seconds),
    setup: { default_category: availableCategory ? defaultCategory as string : "Food" },
    branding: {
      logo_url: logoURL,
      theme_key: THEME_KEYS.has(themeKey as AppBranding["theme_key"]) ? themeKey as AppBranding["theme_key"] : "owambe",
      card_display: CARD_DISPLAYS.has(cardDisplay as AppBranding["card_display"]) ? cardDisplay as AppBranding["card_display"] : "classic",
    },
    home: {
      show_todays_five: home?.show_todays_five === true,
      show_gather_people: home?.show_gather_people === true,
      show_sharp_sharp: home?.show_sharp_sharp === true,
      event_banner: banner ? { event_id: String(banner.event_id ?? ""), headline: String(banner.headline ?? ""), artwork_url: secureURL(banner.artwork_url, "home.event_banner.artwork_url", []), starts_at: bannerStart ?? "", ends_at: bannerEnd ?? "" } : null,
      announcement: validatedAnnouncement,
    },
    categories,
    events: { odogwu_league: { enabled: league?.enabled === true, entry_enabled: league?.entry_enabled === undefined ? league?.enabled === true : league.entry_enabled === true, visible_from: visible, banner_ends_at: bannerEnds, starts_at: starts, ends_at: ends, mode: league?.mode === "cash_ready" ? "cash_ready" : "practice", home_placement: EVENT_PLACEMENTS.has(String(league?.home_placement)) ? league?.home_placement as "none" | "banner" | "card" : "none", headline: league?.headline === null || league?.headline === undefined ? null : String(league.headline), rules_url: secureURL(league?.rules_url, "events.odogwu_league.rules_url", issues), content_release_id: league?.content_release_id === null || league?.content_release_id === undefined ? null : String(league.content_release_id), cash_enabled: league?.cash_enabled === true, weekly_schedule: weeklySchedule && scheduleFirstOpen ? { timezone: "Africa/Lagos", first_open_at: scheduleFirstOpen, open_weekday: Number(weeklySchedule.open_weekday), open_time_local: String(weeklySchedule.open_time_local), close_weekday: Number(weeklySchedule.close_weekday), close_time_local: String(weeklySchedule.close_time_local) } : null } },
  };
  config.events.odogwu_league.show_last_leaderboard = league?.show_last_leaderboard !== false;
  return issues.length ? { issues } : { config, issues: [] };
}

export function safeDefaultAppConfig(now = Date.now()): AppConfigDocument {
  return { schema_version: 1, revision: 0, published_at: new Date(now).toISOString(), cache_ttl_seconds: 900, setup: { default_category: "Food" }, branding: { logo_url: null, theme_key: "owambe", card_display: "classic" }, home: { show_todays_five: true, show_gather_people: true, show_sharp_sharp: false, event_banner: null, announcement: null }, categories: [], events: { odogwu_league: { enabled: false, entry_enabled: false, visible_from: null, banner_ends_at: null, starts_at: null, ends_at: null, mode: "practice", home_placement: "none", headline: null, rules_url: null, content_release_id: null, cash_enabled: false, weekly_schedule: null } } };
}
