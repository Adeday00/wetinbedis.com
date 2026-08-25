import fs from "node:fs/promises";
import process from "node:process";

function parseArguments(argv) {
  const values = new Map();
  let publish = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--publish") {
      publish = true;
      continue;
    }
    if (!value.startsWith("--") || !argv[index + 1]) {
      throw new Error(`Expected --name value, received ${value}`);
    }
    values.set(value.slice(2), argv[index + 1]);
    index += 1;
  }
  return { values, publish };
}

function safeSummary(payload, didPublish) {
  const release = payload?.release ?? {};
  return {
    valid: payload?.valid ?? true,
    published: didPublish ? payload?.published === true : undefined,
    release_id: release.release_id,
    revision: release.revision,
    effective_week_wat: release.effective_week_wat,
    party_cards: release.assets?.party_deck?.item_count,
    solo_questions: release.assets?.solo_gist?.item_count,
    issues: Array.isArray(payload?.issues) ? payload.issues.slice(0, 25) : undefined,
  };
}

const { values, publish } = parseArguments(process.argv.slice(2));
const file = values.get("file");
const configuredBaseURL = values.get("base-url") ?? process.env.WBD_CONTENT_ADMIN_BASE_URL;
const token = process.env.WBD_CONTENT_ADMIN_TOKEN?.trim();
if (!file) throw new Error("--file is required");
if (!configuredBaseURL) {
  throw new Error("--base-url or WBD_CONTENT_ADMIN_BASE_URL is required");
}
if (!token || token.length < 16) {
  throw new Error("WBD_CONTENT_ADMIN_TOKEN must be set to the server-side admin secret");
}

const baseURL = new URL(configuredBaseURL);
if (baseURL.protocol !== "https:" && baseURL.hostname !== "localhost") {
  throw new Error("The content admin base URL must use HTTPS");
}
const body = await fs.readFile(file, "utf8");
if (Buffer.byteLength(body) > 2 * 1_024 * 1_024) {
  throw new Error("Release JSON must be 2 MB or less");
}
JSON.parse(body);

const action = publish ? "publish" : "validate";
const endpoint = new URL(`/api/v1/admin/content/releases/${action}`, baseURL);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body,
});
let payload;
try {
  payload = await response.json();
} catch {
  throw new Error(`Content ${action} returned a non-JSON response (${response.status})`);
}
console.log(JSON.stringify(safeSummary(payload, publish), null, 2));
if (!response.ok) process.exitCode = 1;
