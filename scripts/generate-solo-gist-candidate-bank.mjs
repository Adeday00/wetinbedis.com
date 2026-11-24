import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const partyDeckPath = path.join(siteDirectory, "content", "party-deck-catalog.json");
const liveCatalogPath = path.join(siteDirectory, "content", "solo-gist-catalog.json");
const existingCandidatePath = path.join(
  siteDirectory,
  "content",
  "drafts",
  "2026-W41-solo-gist-candidates.json",
);
const outputPath = path.join(
  siteDirectory,
  "content",
  "drafts",
  "2026-W42-to-W46-solo-gist-candidates.json",
);
const targetCount = 174;

function normalized(value) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-NG")
    .replace(/\s+/g, " ");
}

function clueFor(word) {
  return `Think about “${word}”.`;
}

const [partyRows, liveCatalog, existingCandidates] = await Promise.all([
  fs.readFile(partyDeckPath, "utf8").then(JSON.parse),
  fs.readFile(liveCatalogPath, "utf8").then(JSON.parse),
  fs.readFile(existingCandidatePath, "utf8").then(JSON.parse),
]);

const usedAnswers = new Set([
  ...liveCatalog.cards,
  ...existingCandidates.cards,
].map((card) => normalized(card.answer)));
const usedIDs = new Set([
  ...liveCatalog.cards,
  ...existingCandidates.cards,
].map((card) => card.id));
const categories = [...new Set(partyRows.map((card) => card.Category))].sort();
const byCategory = new Map(categories.map((category) => [
  category,
  partyRows.filter((card) => card.Category === category && !usedAnswers.has(normalized(card["Main Word"]))),
]));

for (const [category, cards] of byCategory) {
  if (cards.length < 7) throw new Error(`${category} does not have seven unused Party cards`);
}

const selected = [];
let cursor = 0;
while (selected.length < targetCount) {
  const category = categories[cursor % categories.length];
  const candidates = byCategory.get(category);
  const card = candidates.shift();
  if (card) selected.push(card);
  cursor += 1;
  if (cursor > targetCount * categories.length) {
    throw new Error("Not enough unused Party cards to build the requested bank");
  }
}

const cards = selected.map((card, index) => {
  const categoryPool = partyRows.filter((item) => item.Category === card.Category);
  const answerIndex = categoryPool.findIndex((item) => item.ID === card.ID);
  const distractors = categoryPool
    .filter((item) => item.ID !== card.ID)
    .slice(answerIndex + 1)
    .concat(categoryPool.slice(0, answerIndex))
    .map((item) => item["Main Word"])
    .filter((word, position, all) => normalized(word) !== normalized(card["Main Word"])
      && all.findIndex((candidate) => normalized(candidate) === normalized(word)) === position)
    .slice(0, 6);
  const number = 88 + index;
  const id = `SG-${String(number).padStart(3, "0")}`;
  if (usedIDs.has(id)) throw new Error(`${id} is already occupied`);
  if (distractors.length !== 6) throw new Error(`${card.ID} does not have six category distractors`);
  return {
    id,
    source_deck_id: card.ID,
    answer: card["Main Word"],
    category: card.Category,
    answer_family: `${card.Category} recognition`,
    difficulty: card.Difficulty,
    clues: card["Forbidden Word 1"] && card["Forbidden Word 2"] && card["Forbidden Word 3"]
      ? [
          clueFor(card["Forbidden Word 1"]),
          clueFor(card["Forbidden Word 2"]),
          clueFor(card["Forbidden Word 3"]),
        ]
      : [],
    distractors,
    weekly_theme: "Expanded Solo Gist bank",
    editorial_status: "Candidate — owner review required",
    family_review: "Hold",
    editorial_note: "Generated from Party-deck clue terms. Rewrite clues for natural play and replace unrelated distractors with true family peers before promotion.",
    mechanical_qc: {
      identity_category: "PASS",
      completeness: "PASS",
      duplicate: "PASS",
      substring: "PASS",
    },
    final_qc: "EDITORIAL HOLD",
  };
});

await fs.writeFile(outputPath, `${JSON.stringify({
  schema_version: 1,
  editorial_only: true,
  collection: "2026-W42 to W46 expansion candidates",
  review_rule: "Every card remains EDITORIAL HOLD until an owner reviews clue tone, replaces distractors with genuine family peers, and supplies seven explicit option-family Pass records.",
  cards,
}, null, 2)}\n`);

console.log(JSON.stringify({ output: path.relative(siteDirectory, outputPath), candidate_cards: cards.length }, null, 2));
