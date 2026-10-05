import fs from "node:fs/promises";
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

function asDailyIDs(release) {
  const packs = release?.solo_gist?.daily_packs;
  if (!Array.isArray(packs) || packs.length !== 7) {
    throw new Error("Previous release does not contain seven daily packs");
  }
  const ids = packs.flatMap((pack) => pack?.question_ids ?? []);
  if (ids.length !== 35 || ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("Previous release daily packs must contain 35 question IDs");
  }
  return new Set(ids.map((id) => id.trim()));
}

const values = parseArguments(process.argv.slice(2));
const catalogPath = values.get("catalog") ?? "content/solo-gist-catalog.json";
const previousReleasePath = values.get("previous-release");
const requiredPerWeek = Number(values.get("required-per-week") ?? "35");
if (!Number.isSafeInteger(requiredPerWeek) || requiredPerWeek <= 0) {
  throw new Error("--required-per-week must be a positive integer");
}

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
if (!Array.isArray(catalog?.cards)) throw new Error("Solo catalog cards array is required");
const ready = catalog.cards.filter(
  (card) => card?.final_qc === "READY" && card?.family_review === "Pass",
);
const readyIDs = new Set(ready.map((card) => card.id).filter((id) => typeof id === "string"));
if (readyIDs.size !== ready.length) throw new Error("Ready Solo card IDs must be unique");

const previousIDs = previousReleasePath
  ? asDailyIDs(JSON.parse(await fs.readFile(previousReleasePath, "utf8")))
  : new Set();
const newReady = ready.filter((card) => !previousIDs.has(card.id));
const payload = {
  ready_questions: ready.length,
  editorial_hold_questions: catalog.cards.length - ready.length,
  weekly_requirement: requiredPerWeek,
  weeks_without_repeats_from_full_ready_pool: Math.floor(ready.length / requiredPerWeek),
  previous_release_checked: previousReleasePath ?? null,
  previous_daily_questions_excluded: previousIDs.size,
  newly_available_questions_for_next_week: newReady.length,
  next_week_ready: newReady.length >= requiredPerWeek,
  additional_approved_questions_needed_for_next_week: Math.max(0, requiredPerWeek - newReady.length),
};
console.log(JSON.stringify(payload, null, 2));
if (!payload.next_week_ready) process.exitCode = 1;
