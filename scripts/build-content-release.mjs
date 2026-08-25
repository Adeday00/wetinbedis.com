import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const catalogPath = path.join(siteDirectory, "content", "solo-gist-catalog.json");
const partyDeckPath = path.join(
  siteDirectory,
  "content",
  "party-deck-catalog.json",
);
const DAY_MS = 86_400_000;
const WAT_OFFSET_MS = 3_600_000;

function argumentsFrom(argv) {
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

function currentWATMonday(offsetWeeks = 0) {
  const shifted = new Date(Date.now() + WAT_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(
    shifted.getUTCDate() - ((shifted.getUTCDay() + 6) % 7) + offsetWeeks * 7,
  );
  return shifted.toISOString().slice(0, 10);
}

function resolveWeek(value) {
  if (value === "current") return currentWATMonday();
  if (value === "next") return currentWATMonday(1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new Error("--week must be current, next, or a YYYY-MM-DD WAT Monday");
  }
  return value;
}

function isoWeekKey(milliseconds) {
  const date = new Date(milliseconds + WAT_OFFSET_MS);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - start.getTime()) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function watISOString(milliseconds) {
  return new Date(milliseconds + WAT_OFFSET_MS)
    .toISOString()
    .replace(/\.000Z$/, "+01:00");
}

function interleaveByCategory(cards) {
  const groups = new Map();
  for (const card of cards) {
    const group = groups.get(card.category) ?? [];
    group.push(card);
    groups.set(card.category, group);
  }
  const categories = [...groups.keys()].sort();
  const result = [];
  while (result.length < cards.length) {
    for (const category of categories) {
      const card = groups.get(category)?.shift();
      if (card) result.push(card);
    }
  }
  return result;
}

function makeQuestions(catalogCards) {
  return catalogCards.map((card) => {
    const numericID = Number(card.id.replace(/\D/g, ""));
    const correctIndex = (numericID - 1) % 7;
    const labels = [...card.distractors];
    labels.splice(correctIndex, 0, card.answer);
    return {
      id: card.id,
      category: card.category,
      answer_family: card.answer_family,
      clues: card.clues,
      options: labels.map((label, index) => ({
        id: `${card.id}-option-${index + 1}`,
        label,
        category: card.category,
        // READY + Family Review Pass is the workbook's explicit declaration
        // that this fixed option set belongs to the reviewed answer family.
        answer_family: card.answer_family,
      })),
      correct_option_id: `${card.id}-option-${correctIndex + 1}`,
      explanation: `${card.answer}: ${card.clues[2]}`,
    };
  });
}

function validateCatalog(catalog, partyRows) {
  if (catalog.schema_version !== 1 || catalog.cards?.length !== 42) {
    throw new Error("The owner catalog must contain exactly 42 schema-v1 cards");
  }
  if (new Set(catalog.cards.map((card) => card.id)).size !== catalog.cards.length) {
    throw new Error("The owner catalog contains duplicate Solo IDs");
  }
  const deckCategoryByAnswer = new Map(
    partyRows.map((row) => [normalized(row["Main Word"]), row.Category]),
  );
  for (const card of catalog.cards) {
    if (Object.values(card.mechanical_qc ?? {}).some((status) => status !== "PASS")) {
      throw new Error(`${card.id} has a non-PASS workbook mechanical gate`);
    }
    for (const label of [card.answer, ...card.distractors]) {
      const category = deckCategoryByAnswer.get(normalized(label));
      if (category !== card.category) {
        throw new Error(`${card.id} option ${label} is not catalogued as ${card.category}`);
      }
    }
  }
}

function makePartyDocument(partyRows, contentVersion) {
  return {
    schema_version: 1,
    content_version: contentVersion,
    cards: partyRows.map((row) => ({
      card_number: row["Card Number"],
      id: row.ID,
      difficulty: row.Difficulty,
      category: row.Category,
      main_word: row["Main Word"],
      forbidden_words: [
        row["Forbidden Word 1"],
        row["Forbidden Word 2"],
        row["Forbidden Word 3"],
      ],
    })),
  };
}

function makeDailyPacks(readyCards, effectiveFromMs) {
  const rotation = interleaveByCategory(readyCards);
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const selected = Array.from(
      { length: 5 },
      (_, offset) => rotation[(dayIndex * 5 + offset) % rotation.length],
    );
    if (new Set(selected.map((card) => card.category)).size < 3) {
      throw new Error(`Daily pack ${dayIndex + 1} has fewer than three categories`);
    }
    return {
      date_wat: new Date(
        effectiveFromMs + dayIndex * DAY_MS + WAT_OFFSET_MS,
      ).toISOString().slice(0, 10),
      question_ids: selected.map((card) => card.id),
    };
  });
}

const args = argumentsFrom(process.argv.slice(2));
const weekDate = resolveWeek(args.get("week"));
const revision = Number(args.get("revision"));
const output = args.get("output");
if (!Number.isSafeInteger(revision) || revision <= 0) {
  throw new Error("--revision must be a positive integer");
}
if (!output) throw new Error("--output is required");

const sponsorKind = args.get("sponsor-kind");
const sponsorName = args.get("sponsor-name")?.trim();
const sponsorMessage = args.get("sponsor-message")?.trim();
if (sponsorKind !== undefined && !["commercial", "prizeFunding"].includes(sponsorKind)) {
  throw new Error("--sponsor-kind must be commercial or prizeFunding");
}
if ((sponsorKind && !sponsorName) || (!sponsorKind && (sponsorName || sponsorMessage))) {
  throw new Error("--sponsor-kind and --sponsor-name must be provided together");
}
if ((sponsorName?.length ?? 0) > 64) {
  throw new Error("--sponsor-name must be 64 characters or fewer");
}
if ((sponsorMessage?.length ?? 0) > 180) {
  throw new Error("--sponsor-message must be 180 characters or fewer");
}

const effectiveFromMs = Date.parse(`${weekDate}T00:00:00+01:00`);
const watMidnight = new Date(effectiveFromMs + WAT_OFFSET_MS);
if (!Number.isFinite(effectiveFromMs) || watMidnight.getUTCDay() !== 1) {
  throw new Error("--week must resolve to a Monday in WAT");
}
const effectiveWeekWAT = isoWeekKey(effectiveFromMs);
const releaseID = args.get("release-id")
  ?? `wbd-${effectiveWeekWAT.toLocaleLowerCase("en-US")}-r${revision}`;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(releaseID)) {
  throw new Error("--release-id contains unsupported characters");
}

const [catalog, partyRows] = await Promise.all([
  fs.readFile(catalogPath, "utf8").then(JSON.parse),
  fs.readFile(partyDeckPath, "utf8").then(JSON.parse),
]);
validateCatalog(catalog, partyRows);

const readyCards = catalog.cards.filter(
  (card) => card.final_qc === "READY" && card.family_review === "Pass",
);
const heldCards = catalog.cards.filter((card) => !readyCards.includes(card));
if (readyCards.length !== 26 || heldCards.length !== 16) {
  throw new Error(
    `Expected 26 READY + 16 held catalog cards; found ${readyCards.length} + ${heldCards.length}`,
  );
}
const categoryCounts = new Map();
for (const card of readyCards) {
  categoryCounts.set(card.category, (categoryCounts.get(card.category) ?? 0) + 1);
}
if (![...categoryCounts.values()].some((count) => count >= 5)) {
  throw new Error("READY catalog has no category with five cards");
}

const contentSuffix = `${effectiveWeekWAT.toLocaleLowerCase("en-US")}-r${revision}`;
const release = {
  schema_version: 1,
  release_id: releaseID,
  revision,
  effective_week_wat: effectiveWeekWAT,
  effective_from_wat: watISOString(effectiveFromMs),
  expires_at_wat: watISOString(effectiveFromMs + 7 * DAY_MS),
  minimum_app_version: "1.0.0",
  ...(sponsorKind && sponsorName
    ? {
        sponsor: {
          kind: sponsorKind,
          sponsor_name: sponsorName,
          ...(sponsorMessage ? { message: sponsorMessage } : {}),
        },
      }
    : {}),
  party_deck: makePartyDocument(partyRows, `party-${contentSuffix}`),
  solo_gist: {
    schema_version: 1,
    content_version: `solo-${contentSuffix}`,
    effective_week_wat: effectiveWeekWAT,
    questions: makeQuestions(readyCards),
    quick_play_question_ids: readyCards.map((card) => card.id),
    daily_packs: makeDailyPacks(readyCards, effectiveFromMs),
  },
};

const outputPath = path.resolve(siteDirectory, output);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(release, null, 2)}\n`);
console.log(
  JSON.stringify({
    output: path.relative(siteDirectory, outputPath),
    release_id: release.release_id,
    revision: release.revision,
    effective_week_wat: release.effective_week_wat,
    party_cards: release.party_deck.cards.length,
    solo_ready: release.solo_gist.questions.length,
    held_in_owner_catalog_only: heldCards.length,
  }),
);
