import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateOptionFamilyReviews } from "./solo-family-validation.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const defaultCandidatePath = "content/drafts/2026-W41-solo-gist-candidates.json";
const partyDeckPath = path.join(siteDirectory, "content", "party-deck-catalog.json");
const catalogPath = path.join(siteDirectory, "content", "solo-gist-catalog.json");
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

function requiredString(value, path, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path}: required string`);
    return "";
  }
  return value.trim();
}

const argumentsByName = parseArguments(process.argv.slice(2));
const candidatePath = path.resolve(
  siteDirectory,
  argumentsByName.get("file") ?? defaultCandidatePath,
);
const [candidateDocument, partyRows, liveCatalog] = await Promise.all([
  fs.readFile(candidatePath, "utf8").then(JSON.parse),
  fs.readFile(partyDeckPath, "utf8").then(JSON.parse),
  fs.readFile(catalogPath, "utf8").then(JSON.parse),
]);

const errors = [];
if (candidateDocument?.schema_version !== 1) {
  errors.push("schema_version: expected 1");
}
if (candidateDocument?.editorial_only !== true) {
  errors.push("editorial_only: must be true");
}
if (!Array.isArray(candidateDocument?.cards)) {
  errors.push("cards: required array");
}
if (!Array.isArray(partyRows) || !Array.isArray(liveCatalog?.cards)) {
  errors.push("catalog sources are malformed");
}

const partyByLabel = new Map(
  (Array.isArray(partyRows) ? partyRows : []).map((row) => [
    normalized(row["Main Word"]),
    { id: row.ID, category: row.Category },
  ]),
);
const occupiedIDs = new Set(
  (Array.isArray(liveCatalog?.cards) ? liveCatalog.cards : [])
    .map((card) => normalized(card?.id))
    .filter(Boolean),
);
const candidateIDs = new Set();

for (const [index, card] of (candidateDocument?.cards ?? []).entries()) {
  const prefix = `cards[${index}]`;
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    errors.push(`${prefix}: object required`);
    continue;
  }

  const id = requiredString(card.id, `${prefix}.id`, errors);
  const answer = requiredString(card.answer, `${prefix}.answer`, errors);
  const category = requiredString(card.category, `${prefix}.category`, errors);
  const sourceDeckID = requiredString(card.source_deck_id, `${prefix}.source_deck_id`, errors);
  if (id) {
    const normalizedID = normalized(id);
    if (candidateIDs.has(normalizedID)) errors.push(`${prefix}.id: duplicate candidate ID`);
    if (occupiedIDs.has(normalizedID)) errors.push(`${prefix}.id: already exists in live catalog`);
    candidateIDs.add(normalizedID);
  }

  if (card.final_qc !== "EDITORIAL HOLD" || card.family_review !== "Hold") {
    errors.push(`${prefix}: candidate must remain EDITORIAL HOLD with family review Hold`);
  }
  if (card.editorial_status !== "Candidate — owner review required") {
    errors.push(`${prefix}.editorial_status: owner-review marker required`);
  }
  if (!Array.isArray(card.clues) || card.clues.length !== 3 || card.clues.some((clue) => !requiredString(clue, `${prefix}.clues`, errors))) {
    errors.push(`${prefix}.clues: exactly three non-empty clues required`);
  }
  if (!Array.isArray(card.distractors) || card.distractors.length !== 6) {
    errors.push(`${prefix}.distractors: exactly six required`);
  }

  const qc = card.mechanical_qc;
  if (!qc || typeof qc !== "object" || Array.isArray(qc)
    || Object.keys(qc).length !== requiredMechanicalChecks.length
    || requiredMechanicalChecks.some((key) => qc[key] !== "PASS")) {
    errors.push(`${prefix}.mechanical_qc: all four PASS checks required`);
  }

  const labels = [answer, ...(Array.isArray(card.distractors) ? card.distractors : [])]
    .map((label) => requiredString(label, `${prefix}.label`, errors))
    .filter(Boolean);
  if (labels.length === 7 && new Set(labels.map(normalized)).size !== labels.length) {
    errors.push(`${prefix}.labels: answer and distractors must be unique`);
  }
  for (const label of labels) {
    const partyCard = partyByLabel.get(normalized(label));
    if (!partyCard) {
      errors.push(`${prefix}.label:${label}: absent from Party deck`);
    } else if (partyCard.category !== category) {
      errors.push(`${prefix}.label:${label}: category mismatch`);
    }
  }
  if (answer && partyByLabel.get(normalized(answer))?.id !== sourceDeckID) {
    errors.push(`${prefix}.source_deck_id: must match Party answer ID`);
  }
  const clueText = (card.clues ?? []).map(normalized).join(" ");
  if (normalized(answer).length >= 3 && clueText.includes(normalized(answer))) {
    errors.push(`${prefix}.clues: answer leak`);
  }
  // Held candidates may omit family evidence while research is unfinished.
  // If evidence is present, validate it now; promotion will require all seven
  // explicit Pass records and will never manufacture them.
  if (card.option_family_reviews !== undefined) {
    for (const issue of validateOptionFamilyReviews(card).issues) {
      errors.push(`${prefix}.${issue}`);
    }
  }
}

const payload = {
  file: path.relative(siteDirectory, candidatePath),
  candidate_cards: candidateDocument?.cards?.length ?? 0,
  mechanically_valid: errors.length === 0,
  editorially_approved_cards: 0,
  errors,
};
console.log(JSON.stringify(payload, null, 2));
if (errors.length) process.exitCode = 1;
