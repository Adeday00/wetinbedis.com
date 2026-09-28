import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { requireReviewedOptionFamilies } from "./solo-family-validation.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const defaultCandidatePath = "content/drafts/2026-W41-solo-gist-candidates.json";
const catalogPath = path.join(siteDirectory, "content", "solo-gist-catalog.json");
const partyDeckPath = path.join(siteDirectory, "content", "party-deck-catalog.json");
const requiredMechanicalChecks = [
  "identity_category",
  "completeness",
  "duplicate",
  "substring",
];

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || !argv[index + 1]) {
      throw new Error(`Expected --name value, received ${key}`);
    }
    values.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  return values;
}

function normalized(value) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-NG")
    .replace(/\s+/g, " ");
}

function fail(message) {
  throw new Error(message);
}

function assertPromotable(card, partyByLabel) {
  if (card?.final_qc !== "EDITORIAL HOLD" || card?.family_review !== "Hold") {
    fail(`${card?.id ?? "unknown"}: candidate is not in an editorial hold state`);
  }
  if (card.editorial_status !== "Candidate — owner review required") {
    fail(`${card.id}: candidate does not require explicit owner review`);
  }
  if (!Array.isArray(card.clues) || card.clues.length !== 3) {
    fail(`${card.id}: exactly three clues are required`);
  }
  if (!Array.isArray(card.distractors) || card.distractors.length !== 6) {
    fail(`${card.id}: exactly six distractors are required`);
  }
  if (!card.mechanical_qc
    || requiredMechanicalChecks.some((check) => card.mechanical_qc[check] !== "PASS")) {
    fail(`${card.id}: the candidate does not have four passing mechanical checks`);
  }

  const labels = [card.answer, ...card.distractors];
  if (labels.some((label) => typeof label !== "string" || !label.trim())) {
    fail(`${card.id}: answer labels must be non-empty strings`);
  }
  if (new Set(labels.map(normalized)).size !== 7) {
    fail(`${card.id}: answer and distractors must be seven unique labels`);
  }
  for (const label of labels) {
    const source = partyByLabel.get(normalized(label));
    if (!source || source.category !== card.category) {
      fail(`${card.id}: ${label} is not a ${card.category} Party label`);
    }
  }
  if (partyByLabel.get(normalized(card.answer))?.id !== card.source_deck_id) {
    fail(`${card.id}: source deck ID does not match its Party answer label`);
  }
  const clueText = card.clues.map(normalized).join(" ");
  if (normalized(card.answer).length >= 3 && clueText.includes(normalized(card.answer))) {
    fail(`${card.id}: clues leak the answer`);
  }
  // Promotion is an explicit editorial action, but it is not allowed to
  // invent family membership. Each answer and distractor needs its own Pass.
  requireReviewedOptionFamilies(card);
}

const argumentsByName = parseArguments(process.argv.slice(2));
const requestedIDs = (argumentsByName.get("approve") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (!requestedIDs.length) {
  fail("Use --approve SG-053,SG-054 after reviewing the candidates.");
}
if (new Set(requestedIDs.map(normalized)).size !== requestedIDs.length) {
  fail("--approve contains duplicate IDs");
}
const dryRunValue = argumentsByName.get("dry-run") ?? "false";
if (!["true", "false"].includes(dryRunValue)) {
  fail("--dry-run must be true or false");
}
const dryRun = dryRunValue === "true";

const candidatePath = path.resolve(
  siteDirectory,
  argumentsByName.get("file") ?? defaultCandidatePath,
);
const [candidateDocument, catalog, partyRows] = await Promise.all([
  fs.readFile(candidatePath, "utf8").then(JSON.parse),
  fs.readFile(catalogPath, "utf8").then(JSON.parse),
  fs.readFile(partyDeckPath, "utf8").then(JSON.parse),
]);
if (candidateDocument?.schema_version !== 1 || candidateDocument?.editorial_only !== true
  || !Array.isArray(candidateDocument.cards)) {
  fail("Candidate document must be an editorial-only schema-v1 card collection");
}
if (catalog?.schema_version !== 1 || !Array.isArray(catalog.cards)) {
  fail("Live Solo catalog must be a schema-v1 card collection");
}
if (!Array.isArray(partyRows)) fail("Party catalog is malformed");

const candidatesByID = new Map(candidateDocument.cards.map((card) => [normalized(card.id), card]));
const existingIDs = new Set(catalog.cards.map((card) => normalized(card.id)));
const partyByLabel = new Map(partyRows.map((row) => [
  normalized(row["Main Word"]),
  { id: row.ID, category: row.Category },
]));
const approved = requestedIDs.map((requestedID) => {
  const card = candidatesByID.get(normalized(requestedID));
  if (!card) fail(`${requestedID}: not found in the candidate bank`);
  if (existingIDs.has(normalized(card.id))) fail(`${card.id}: already exists in the live catalog`);
  assertPromotable(card, partyByLabel);
  return {
    ...card,
    editorial_status: "Ready for Playtest",
    family_review: "Pass",
    editorial_note: "Explicitly promoted from the owner-reviewed candidate bank; randomize display order only.",
    final_qc: "READY",
  };
});

// All requested cards are fully validated before this single write. This tool
// never publishes a release, changes a prior card, or removes a candidate.
const updatedCatalog = { ...catalog, cards: [...catalog.cards, ...approved] };
if (!dryRun) {
  await fs.writeFile(catalogPath, `${JSON.stringify(updatedCatalog, null, 2)}\n`);
}
console.log(JSON.stringify({
  promoted_cards: approved.map((card) => card.id),
  live_catalog_card_count_after_promotion: updatedCatalog.cards.length,
  dry_run: dryRun,
  publish_performed: false,
  next_step: dryRun
    ? "Review the proposed IDs, then repeat with --dry-run false to update the local catalog."
    : "Run content:capacity, then content:build. Publishing remains a separate owner action.",
}, null, 2));
