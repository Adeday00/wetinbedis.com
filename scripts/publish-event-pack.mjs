#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function timestamp(value, name) {
  if (value === undefined) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= Date.now()) {
    throw new Error(`--${name} must be a future ISO 8601 date/time.`);
  }
  return parsed;
}

try {
  const file = argument("file");
  const title = argument("title")?.trim();
  const accessMode = argument("access-mode");
  const base = process.env.WBD_CONTENT_ADMIN_BASE_URL?.trim();
  const token = process.env.WBD_CONTENT_ADMIN_TOKEN;
  if (!file || !title || !base || !token) {
    throw new Error("Provide --file, --title, --access-mode and the WBD_CONTENT_ADMIN_BASE_URL / WBD_CONTENT_ADMIN_TOKEN environment values.");
  }
  if (!new Set(["permanent", "event_end"]).has(accessMode)) {
    throw new Error("--access-mode must be permanent or event_end.");
  }
  const url = new URL("/api/v1/admin/event-packs/publish", base);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("The event pack publishing endpoint must use HTTPS.");
  }
  const content = JSON.parse(await readFile(file, "utf8"));
  const expiresAt = timestamp(argument("expires-at"), "expires-at");
  const codeExpiresAt = timestamp(argument("code-expires-at"), "code-expires-at");
  if (accessMode === "event_end" && expiresAt === null) {
    throw new Error("event_end access requires --expires-at.");
  }
  if (accessMode === "permanent" && expiresAt !== null) {
    throw new Error("permanent access cannot use --expires-at.");
  }
  const maxRedemptionsRaw = argument("max-redemptions");
  const maxRedemptions = maxRedemptionsRaw === undefined ? null : Number(maxRedemptionsRaw);
  if (maxRedemptions !== null && (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1)) {
    throw new Error("--max-redemptions must be a positive integer.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title,
      access_mode: accessMode,
      expires_at_ms: expiresAt,
      code_expires_at_ms: codeExpiresAt,
      max_redemptions: maxRedemptions,
      cards: content.cards,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.published !== true) {
    const issues = Array.isArray(result.issues) ? result.issues.join(", ") : `HTTP ${response.status}`;
    throw new Error(`Event pack was not published: ${issues}`);
  }
  console.log(`Pack published: ${result.pack.id} (${result.pack.card_count} cards)`);
  console.log(`Access: ${result.pack.access_mode}${result.pack.expires_at_ms ? ` until ${new Date(result.pack.expires_at_ms).toISOString()}` : "; permanent"}`);
  console.log(`One-time redemption code: ${result.redemption_code}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Event pack publishing failed.");
  process.exitCode = 1;
}
