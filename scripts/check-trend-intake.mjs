import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const defaultIntakePath = "content/drafts/trend-intake-template.json";
const supportedPlatforms = new Set(["facebook", "instagram", "tiktok", "x"]);
const signalKeys = new Set([
  "id",
  "platform",
  "observed_wat",
  "topic",
  "why_it_might_be_fun",
  "source_content_copied",
  "personal_data_saved",
  "direct_post_link_saved",
  "fact_checks",
  "reviewer_status",
]);
const factCheckKeys = new Set(["source_type", "title", "url"]);

function requiredString(value, field, errors, minimum = 1, maximum = 240) {
  if (typeof value !== "string") {
    errors.push(`${field}: required string`);
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    errors.push(`${field}: must contain ${minimum}-${maximum} characters`);
  }
  return trimmed;
}

function hasOnlyKeys(value, allowedKeys, field, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field}: object required`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${field}.${key}: unknown field`);
  }
  return true;
}

function isSafeResearchText(value) {
  return !/(https?:\/\/|www\.|@[a-z0-9_.]+)/i.test(value);
}

function isIndependentFactURL(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !host.endsWith("tiktok.com")
      && !host.endsWith("instagram.com")
      && !host.endsWith("facebook.com")
      && !host.endsWith("x.com")
      && !host.endsWith("twitter.com");
  } catch {
    return false;
  }
}

const values = process.argv.slice(2);
const fileArgument = values.length === 2 && values[0] === "--file" ? values[1] : null;
if (values.length && !fileArgument) {
  throw new Error("Use --file content/drafts/my-trend-intake.json");
}
const intakePath = path.resolve(siteDirectory, fileArgument ?? defaultIntakePath);
const document = JSON.parse(await fs.readFile(intakePath, "utf8"));
const errors = [];

if (document?.schema_version !== 1) errors.push("schema_version: expected 1");
if (document?.editorial_only !== true) errors.push("editorial_only: must be true");
if (!Array.isArray(document?.signals)) errors.push("signals: required array");

const signalIDs = new Set();
for (const [index, signal] of (document?.signals ?? []).entries()) {
  const prefix = `signals[${index}]`;
  if (!hasOnlyKeys(signal, signalKeys, prefix, errors)) continue;
  const id = requiredString(signal.id, `${prefix}.id`, errors, 4, 80).toUpperCase();
  if (id && signalIDs.has(id)) errors.push(`${prefix}.id: duplicate signal ID`);
  signalIDs.add(id);

  if (!supportedPlatforms.has(signal.platform)) {
    errors.push(`${prefix}.platform: must be facebook, instagram, tiktok, or x`);
  }
  const observedWAT = requiredString(signal.observed_wat, `${prefix}.observed_wat`, errors, 25, 25);
  if (!observedWAT.endsWith("+01:00") || Number.isNaN(Date.parse(observedWAT))) {
    errors.push(`${prefix}.observed_wat: valid WAT (+01:00) timestamp required`);
  }

  for (const field of ["topic", "why_it_might_be_fun"]) {
    const text = requiredString(signal[field], `${prefix}.${field}`, errors, 3, 240);
    if (text && !isSafeResearchText(text)) {
      errors.push(`${prefix}.${field}: do not save handles, post links, or copied social content`);
    }
  }
  for (const field of ["source_content_copied", "personal_data_saved", "direct_post_link_saved"]) {
    if (signal[field] !== false) errors.push(`${prefix}.${field}: must be false`);
  }
  if (signal.reviewer_status !== "Research hold") {
    errors.push(`${prefix}.reviewer_status: must remain Research hold`);
  }

  if (!Array.isArray(signal.fact_checks) || signal.fact_checks.length < 1 || signal.fact_checks.length > 3) {
    errors.push(`${prefix}.fact_checks: provide 1-3 independent factual references`);
    continue;
  }
  for (const [factIndex, factCheck] of signal.fact_checks.entries()) {
    const factPrefix = `${prefix}.fact_checks[${factIndex}]`;
    if (!hasOnlyKeys(factCheck, factCheckKeys, factPrefix, errors)) continue;
    if (!["official", "reputable_reference"].includes(factCheck.source_type)) {
      errors.push(`${factPrefix}.source_type: must be official or reputable_reference`);
    }
    requiredString(factCheck.title, `${factPrefix}.title`, errors, 3, 160);
    if (!isIndependentFactURL(requiredString(factCheck.url, `${factPrefix}.url`, errors, 10, 500))) {
      errors.push(`${factPrefix}.url: must be an independent HTTPS fact source, not a social post`);
    }
  }
}

console.log(JSON.stringify({
  file: path.relative(siteDirectory, intakePath),
  trend_signals: document?.signals?.length ?? 0,
  valid: errors.length === 0,
  promotion_performed: false,
  errors,
}, null, 2));
if (errors.length) process.exitCode = 1;
