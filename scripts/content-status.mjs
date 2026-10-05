import process from "node:process";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--") || !argv[index + 1]) {
      throw new Error(`Expected --name value, received ${value}`);
    }
    values.set(value.slice(2), argv[index + 1]);
    index += 1;
  }
  return values;
}

const values = parseArguments(process.argv.slice(2));
const configuredBaseURL = values.get("base-url") ?? process.env.WBD_CONTENT_PUBLIC_BASE_URL;
const expectedRelease = values.get("expected-release");
if (!configuredBaseURL) {
  throw new Error("--base-url or WBD_CONTENT_PUBLIC_BASE_URL is required");
}

const baseURL = new URL(configuredBaseURL);
if (baseURL.protocol !== "https:" && baseURL.hostname !== "localhost") {
  throw new Error("The public content base URL must use HTTPS");
}

const endpoint = new URL("/api/v1/content/manifest", baseURL);
let response;
try {
  response = await fetch(endpoint, { headers: { accept: "application/json" } });
} catch {
  console.log(JSON.stringify({ active: false, reason: "network_error" }, null, 2));
  process.exitCode = 1;
  process.exit();
}

let payload;
try {
  payload = await response.json();
} catch {
  console.log(JSON.stringify({ active: false, reason: "invalid_json", status: response.status }, null, 2));
  process.exitCode = 1;
  process.exit();
}

if (!response.ok) {
  console.log(JSON.stringify({
    active: false,
    status: response.status,
    code: payload?.error?.code ?? "manifest_unavailable",
  }, null, 2));
  process.exitCode = 1;
  process.exit();
}

const manifestVersion = typeof payload?.manifest_version === "string"
  ? payload.manifest_version
  : null;
const revision = Number.isSafeInteger(payload?.revision) && payload.revision > 0
  ? payload.revision
  : null;
const effectiveFromWAT = typeof payload?.effective_from_wat === "string"
  ? payload.effective_from_wat
  : null;
const expiresAtWAT = typeof payload?.expires_at_wat === "string"
  ? payload.expires_at_wat
  : null;
const effectiveFrom = effectiveFromWAT ? Date.parse(effectiveFromWAT) : Number.NaN;
const expiresAt = expiresAtWAT ? Date.parse(expiresAtWAT) : Number.NaN;
const scheduleIsCurrent = Number.isFinite(effectiveFrom)
  && Number.isFinite(expiresAt)
  && effectiveFrom < expiresAt
  && effectiveFrom <= Date.now()
  && Date.now() < expiresAt;
const matchesExpectedRelease = !expectedRelease || manifestVersion === expectedRelease;
const manifestIsUsable = Boolean(manifestVersion)
  && revision !== null
  && scheduleIsCurrent;
console.log(JSON.stringify({
  active: manifestIsUsable && matchesExpectedRelease,
  manifest_version: manifestVersion,
  revision,
  effective_week_wat: payload?.effective_week_wat ?? null,
  effective_from_wat: effectiveFromWAT,
  expires_at_wat: expiresAtWAT,
  schedule_is_current: scheduleIsCurrent,
  matches_expected_release: matchesExpectedRelease,
}, null, 2));
if (!manifestIsUsable || !matchesExpectedRelease) process.exitCode = 1;
