import { sha256Hex } from "./crypto";

export const REMOTE_CONTENT_SCHEMA_VERSION = 1;
export const PARTY_DECK_KIND = "party_deck";
export const SOLO_GIST_KIND = "solo_gist";

const DAY_MS = 24 * 60 * 60 * 1000;
const WAT_OFFSET_MS = 60 * 60 * 1000;
const MIN_PARTY_CARDS = 350;
const MAX_PARTY_CARDS = 2_000;
const MIN_SOLO_QUESTIONS = 25;
const MAX_SOLO_QUESTIONS = 1_000;
const SOLO_CLUE_COUNT = 3;
const SOLO_OPTION_COUNT = 7;
const SOLO_DAILY_COUNT = 5;
const MIN_PREMIUM_SOLO_QUESTIONS = 10;
const FREE_CATEGORY_NAMES = new Set(["food", "naija life", "slang"]);
const CANONICAL_CATEGORIES = new Map<string, string>([
  ["celebrities", "Celebrities"],
  ["culture", "Culture"],
  ["diaspora", "Diaspora"],
  ["food", "Food"],
  ["music", "Music"],
  ["naija life", "Naija Life"],
  ["religion", "Religion"],
  ["school", "School"],
  ["slang", "Slang"],
  ["street & hustle", "Street & Hustle"],
]);
const PARTY_CATEGORY_FLOORS = new Map<string, number>([
  ["celebrities", 47],
  ["culture", 28],
  ["diaspora", 27],
  ["food", 34],
  ["music", 53],
  ["naija life", 61],
  ["religion", 18],
  ["school", 18],
  ["slang", 54],
  ["street & hustle", 10],
]);

type JsonRecord = Record<string, unknown>;

export type PreparedContentAsset = {
  kind: typeof PARTY_DECK_KIND | typeof SOLO_GIST_KIND;
  contentVersion: string;
  sha256: string;
  byteCount: number;
  itemCount: number;
  payloadJson: string;
};

export type PreparedSponsorConfiguration = {
  kind: "commercial" | "prizeFunding";
  sponsorName: string;
  message: string | null;
};

export type PreparedContentRelease = {
  id: string;
  revision: number;
  schemaVersion: number;
  effectiveWeekWat: string;
  effectiveFromMs: number;
  expiresAtMs: number;
  effectiveFromWat: string;
  expiresAtWat: string;
  minimumAppVersion: string;
  sponsor: PreparedSponsorConfiguration | null;
  assets: [PreparedContentAsset, PreparedContentAsset];
};

export type ContentReleaseValidation = {
  issues: string[];
  release?: PreparedContentRelease;
};

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-NG")
    .replace(/\s+/g, " ");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;

  const source = value as JsonRecord;
  const result: JsonRecord = {};
  for (const key of Object.keys(source).sort()) {
    result[key] = canonicalValue(source[key]);
  }
  return result;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function asRecord(value: unknown, path: string, issues: string[]): JsonRecord | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    issues.push(`${path}:object_required`);
    return null;
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(`${path}:unknown_field:${key}`);
  }
}

function requiredString(
  value: JsonRecord,
  key: string,
  path: string,
  issues: string[],
  maximumLength = 240,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string") {
    issues.push(`${path}.${key}:string_required`);
    return "";
  }
  const trimmed = candidate.trim();
  if (!trimmed) issues.push(`${path}.${key}:blank`);
  if (trimmed.length > maximumLength) {
    issues.push(`${path}.${key}:too_long:${trimmed.length}/${maximumLength}`);
  }
  return trimmed;
}

function requiredInteger(
  value: JsonRecord,
  key: string,
  path: string,
  issues: string[],
): number {
  const candidate = value[key];
  if (!Number.isSafeInteger(candidate)) {
    issues.push(`${path}.${key}:integer_required`);
    return 0;
  }
  return candidate as number;
}

function optionalString(
  value: JsonRecord,
  key: string,
  path: string,
  issues: string[],
  maximumLength: number,
): string | null {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate !== "string") {
    issues.push(`${path}.${key}:string_required`);
    return null;
  }
  const trimmed = candidate.trim().replace(/\s+/g, " ");
  if (trimmed.length > maximumLength) {
    issues.push(`${path}.${key}:too_long:${trimmed.length}/${maximumLength}`);
  }
  return trimmed || null;
}

function stringArray(
  value: unknown,
  path: string,
  issues: string[],
  expectedCount?: number,
): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path}:array_required`);
    return [];
  }
  if (expectedCount !== undefined && value.length !== expectedCount) {
    issues.push(`${path}:count:${value.length}/${expectedCount}`);
  }
  return value.map((candidate, index) => {
    if (typeof candidate !== "string" || !candidate.trim()) {
      issues.push(`${path}[${index}]:nonempty_string_required`);
      return "";
    }
    const trimmed = candidate.trim();
    if (trimmed.length > 500) issues.push(`${path}[${index}]:too_long`);
    return trimmed;
  });
}

function uniqueNormalized(values: string[]): boolean {
  return new Set(values.map(normalized)).size === values.length;
}

function validVersion(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

function validSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function watDateKey(milliseconds: number): string {
  return new Date(milliseconds + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

export function isoWeekKeyAtWAT(milliseconds: number): string {
  const date = new Date(milliseconds + WAT_OFFSET_MS);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function parseSchedule(
  input: JsonRecord,
  issues: string[],
): {
  effectiveWeekWat: string;
  effectiveFromMs: number;
  expiresAtMs: number;
  effectiveFromWat: string;
  expiresAtWat: string;
} {
  const effectiveWeekWat = requiredString(input, "effective_week_wat", "release", issues, 8);
  const effectiveFromWat = requiredString(input, "effective_from_wat", "release", issues, 35);
  const expiresAtWat = requiredString(input, "expires_at_wat", "release", issues, 35);
  const watMidnight = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?\+01:00$/;

  if (!/^\d{4}-W\d{2}$/.test(effectiveWeekWat)) {
    issues.push("release.effective_week_wat:invalid_iso_week");
  }
  if (!watMidnight.test(effectiveFromWat)) {
    issues.push("release.effective_from_wat:wat_monday_midnight_required");
  }
  if (!watMidnight.test(expiresAtWat)) {
    issues.push("release.expires_at_wat:wat_monday_midnight_required");
  }

  const effectiveFromMs = Date.parse(effectiveFromWat);
  const expiresAtMs = Date.parse(expiresAtWat);
  if (!Number.isFinite(effectiveFromMs)) issues.push("release.effective_from_wat:invalid_date");
  if (!Number.isFinite(expiresAtMs)) issues.push("release.expires_at_wat:invalid_date");

  if (Number.isFinite(effectiveFromMs)) {
    const shifted = new Date(effectiveFromMs + WAT_OFFSET_MS);
    if (shifted.getUTCDay() !== 1 || shifted.getUTCHours() !== 0) {
      issues.push("release.effective_from_wat:monday_midnight_required");
    }
    if (isoWeekKeyAtWAT(effectiveFromMs) !== effectiveWeekWat) {
      issues.push("release.effective_week_wat:does_not_match_effective_from");
    }
  }
  if (
    Number.isFinite(effectiveFromMs) &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs - effectiveFromMs !== 7 * DAY_MS
  ) {
    issues.push("release.schedule:exactly_seven_days_required");
  }

  return {
    effectiveWeekWat,
    effectiveFromMs,
    expiresAtMs,
    effectiveFromWat,
    expiresAtWat,
  };
}

function parsePartyDeck(value: unknown, issues: string[]) {
  const input = asRecord(value, "party_deck", issues);
  if (!input) return null;
  exactKeys(input, ["schema_version", "content_version", "cards"], "party_deck", issues);

  const schemaVersion = requiredInteger(input, "schema_version", "party_deck", issues);
  const contentVersion = requiredString(input, "content_version", "party_deck", issues, 80);
  if (schemaVersion !== REMOTE_CONTENT_SCHEMA_VERSION) {
    issues.push(`party_deck.schema_version:unsupported:${schemaVersion}`);
  }
  if (!validVersion(contentVersion)) issues.push("party_deck.content_version:invalid");
  if (!Array.isArray(input.cards)) {
    issues.push("party_deck.cards:array_required");
    return null;
  }
  if (input.cards.length < MIN_PARTY_CARDS || input.cards.length > MAX_PARTY_CARDS) {
    issues.push(
      `party_deck.cards:count:${input.cards.length}/${MIN_PARTY_CARDS}-${MAX_PARTY_CARDS}`,
    );
  }

  const cards: JsonRecord[] = [];
  const numbers = new Set<number>();
  const ids = new Set<string>();
  const mainWords = new Set<string>();
  input.cards.forEach((candidate, index) => {
    const path = `party_deck.cards[${index}]`;
    const card = asRecord(candidate, path, issues);
    if (!card) return;
    exactKeys(
      card,
      ["card_number", "id", "difficulty", "category", "main_word", "forbidden_words"],
      path,
      issues,
    );
    const cardNumber = requiredInteger(card, "card_number", path, issues);
    const id = requiredString(card, "id", path, issues, 80);
    const difficulty = requiredString(card, "difficulty", path, issues, 20);
    const category = requiredString(card, "category", path, issues, 80);
    const mainWord = requiredString(card, "main_word", path, issues, 120);
    const forbiddenWords = stringArray(card.forbidden_words, `${path}.forbidden_words`, issues, 3);

    if (cardNumber <= 0) issues.push(`${path}.card_number:positive_required`);
    if (numbers.has(cardNumber)) issues.push(`${path}.card_number:duplicate:${cardNumber}`);
    numbers.add(cardNumber);
    const normalizedID = normalized(id);
    if (ids.has(normalizedID)) issues.push(`${path}.id:duplicate:${id}`);
    ids.add(normalizedID);
    const normalizedMain = normalized(mainWord);
    if (mainWords.has(normalizedMain)) issues.push(`${path}.main_word:duplicate:${mainWord}`);
    mainWords.add(normalizedMain);
    if (!new Set(["Easy", "Medium", "Hard"]).has(difficulty)) {
      issues.push(`${path}.difficulty:invalid:${difficulty}`);
    }
    if (CANONICAL_CATEGORIES.get(normalized(category)) !== category) {
      issues.push(`${path}.category:canonical_value_required`);
    }
    if (!uniqueNormalized(forbiddenWords)) issues.push(`${path}.forbidden_words:duplicates`);
    if (
      forbiddenWords.some((word) => {
        const forbidden = normalized(word);
        return forbidden.length > 0 && normalizedMain.includes(forbidden);
      })
    ) {
      issues.push(`${path}.forbidden_words:main_word_leak`);
    }

    cards.push({
      card_number: cardNumber,
      id,
      difficulty,
      category,
      main_word: mainWord,
      forbidden_words: forbiddenWords,
    });
  });

  const categoryCounts = new Map<string, number>();
  for (const card of cards) {
    const category = normalized(String(card.category));
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  for (const [category, floor] of PARTY_CATEGORY_FLOORS) {
    const count = categoryCounts.get(category) ?? 0;
    if (count < floor) {
      issues.push(`party_deck.cards:category_floor:${category}:${count}/${floor}`);
    }
  }

  return {
    schema_version: schemaVersion,
    content_version: contentVersion,
    cards,
  };
}

function parseSoloGist(
  value: unknown,
  releaseWeek: string,
  effectiveFromMs: number,
  issues: string[],
) {
  const input = asRecord(value, "solo_gist", issues);
  if (!input) return null;
  exactKeys(
    input,
    [
      "schema_version",
      "content_version",
      "effective_week_wat",
      "questions",
      "quick_play_question_ids",
      "daily_packs",
    ],
    "solo_gist",
    issues,
  );

  const schemaVersion = requiredInteger(input, "schema_version", "solo_gist", issues);
  const contentVersion = requiredString(input, "content_version", "solo_gist", issues, 80);
  const effectiveWeekWat = requiredString(input, "effective_week_wat", "solo_gist", issues, 8);
  if (schemaVersion !== REMOTE_CONTENT_SCHEMA_VERSION) {
    issues.push(`solo_gist.schema_version:unsupported:${schemaVersion}`);
  }
  if (!validVersion(contentVersion)) issues.push("solo_gist.content_version:invalid");
  if (effectiveWeekWat !== releaseWeek) {
    issues.push("solo_gist.effective_week_wat:release_mismatch");
  }
  if (!Array.isArray(input.questions)) {
    issues.push("solo_gist.questions:array_required");
    return null;
  }
  if (
    input.questions.length < MIN_SOLO_QUESTIONS ||
    input.questions.length > MAX_SOLO_QUESTIONS
  ) {
    issues.push(
      `solo_gist.questions:count:${input.questions.length}/${MIN_SOLO_QUESTIONS}-${MAX_SOLO_QUESTIONS}`,
    );
  }

  const questions: JsonRecord[] = [];
  const questionIDs = new Set<string>();
  const questionByID = new Map<string, { category: string }>();
  const globalOptionIDs = new Set<string>();
  input.questions.forEach((candidate, index) => {
    const path = `solo_gist.questions[${index}]`;
    const question = asRecord(candidate, path, issues);
    if (!question) return;
    exactKeys(
      question,
      [
        "id",
        "category",
        "answer_family",
        "clues",
        "options",
        "correct_option_id",
        "explanation",
      ],
      path,
      issues,
    );
    const id = requiredString(question, "id", path, issues, 80);
    const category = requiredString(question, "category", path, issues, 80);
    const answerFamily = requiredString(question, "answer_family", path, issues, 120);
    const clues = stringArray(question.clues, `${path}.clues`, issues, SOLO_CLUE_COUNT);
    const correctOptionID = requiredString(question, "correct_option_id", path, issues, 120);
    const explanation = requiredString(question, "explanation", path, issues, 1_000);
    const normalizedID = normalized(id);
    if (questionIDs.has(normalizedID)) issues.push(`${path}.id:duplicate:${id}`);
    questionIDs.add(normalizedID);
    questionByID.set(id, { category });
    if (CANONICAL_CATEGORIES.get(normalized(category)) !== category) {
      issues.push(`${path}.category:canonical_value_required`);
    }

    const options: JsonRecord[] = [];
    if (!Array.isArray(question.options)) {
      issues.push(`${path}.options:array_required`);
    } else {
      if (question.options.length !== SOLO_OPTION_COUNT) {
        issues.push(`${path}.options:count:${question.options.length}/${SOLO_OPTION_COUNT}`);
      }
      const optionIDs = new Set<string>();
      const optionLabels = new Set<string>();
      question.options.forEach((optionCandidate, optionIndex) => {
        const optionPath = `${path}.options[${optionIndex}]`;
        const option = asRecord(optionCandidate, optionPath, issues);
        if (!option) return;
        exactKeys(
          option,
          ["id", "label", "category", "answer_family"],
          optionPath,
          issues,
        );
        const optionID = requiredString(option, "id", optionPath, issues, 120);
        const label = requiredString(option, "label", optionPath, issues, 160);
        const optionCategory = requiredString(option, "category", optionPath, issues, 80);
        const optionAnswerFamily = requiredString(
          option,
          "answer_family",
          optionPath,
          issues,
          120,
        );
        const normalizedOptionID = normalized(optionID);
        const normalizedLabel = normalized(label);
        if (optionIDs.has(normalizedOptionID)) issues.push(`${optionPath}.id:duplicate`);
        if (optionLabels.has(normalizedLabel)) issues.push(`${optionPath}.label:duplicate`);
        if (globalOptionIDs.has(normalizedOptionID)) {
          issues.push(`${optionPath}.id:not_globally_unique`);
        }
        optionIDs.add(normalizedOptionID);
        optionLabels.add(normalizedLabel);
        globalOptionIDs.add(normalizedOptionID);
        if (optionCategory !== category) {
          issues.push(`${optionPath}.category:question_mismatch`);
        }
        if (optionAnswerFamily !== answerFamily) {
          issues.push(`${optionPath}.answer_family:question_mismatch`);
        }
        options.push({
          id: optionID,
          label,
          category: optionCategory,
          answer_family: optionAnswerFamily,
        });
      });
    }

    const correctOptions = options.filter((option) => option.id === correctOptionID);
    if (correctOptions.length !== 1) issues.push(`${path}.correct_option_id:missing_or_duplicate`);
    const answerLabel = correctOptions[0]?.label;
    if (
      typeof answerLabel === "string" &&
      normalized(answerLabel).length >= 3 &&
      normalized(clues.join(" ")).includes(normalized(answerLabel))
    ) {
      issues.push(`${path}.clues:answer_leak`);
    }

    questions.push({
      id,
      category,
      answer_family: answerFamily,
      clues,
      options,
      correct_option_id: correctOptionID,
      explanation,
    });
  });

  const quickPlayIDs = stringArray(
    input.quick_play_question_ids,
    "solo_gist.quick_play_question_ids",
    issues,
  );
  if (quickPlayIDs.length < MIN_SOLO_QUESTIONS) {
    issues.push(`solo_gist.quick_play_question_ids:minimum:${MIN_SOLO_QUESTIONS}`);
  }
  if (!uniqueNormalized(quickPlayIDs)) {
    issues.push("solo_gist.quick_play_question_ids:duplicates");
  }
  for (const id of quickPlayIDs) {
    if (!questionByID.has(id)) issues.push(`solo_gist.quick_play_question_ids:unknown:${id}`);
  }
  const quickPlayCategoryCounts = new Map<string, number>();
  for (const id of quickPlayIDs) {
    const question = questionByID.get(id);
    if (!question) continue;
    const category = normalized(question.category);
    quickPlayCategoryCounts.set(category, (quickPlayCategoryCounts.get(category) ?? 0) + 1);
  }
  if (![...quickPlayCategoryCounts.values()].some((count) => count >= 5)) {
    issues.push("solo_gist.quick_play_question_ids:no_category_with_five_questions");
  }
  const premiumQuestionCount = quickPlayIDs.filter((id) => {
    const question = questionByID.get(id);
    return question && !FREE_CATEGORY_NAMES.has(normalized(question.category));
  }).length;
  if (premiumQuestionCount < MIN_PREMIUM_SOLO_QUESTIONS) {
    issues.push(
      `solo_gist.quick_play_question_ids:premium_minimum:${premiumQuestionCount}/${MIN_PREMIUM_SOLO_QUESTIONS}`,
    );
  }
  const quickPlaySet = new Set(quickPlayIDs);

  const dailyPacks: JsonRecord[] = [];
  if (!Array.isArray(input.daily_packs)) {
    issues.push("solo_gist.daily_packs:array_required");
  } else {
    if (input.daily_packs.length !== 7) {
      issues.push(`solo_gist.daily_packs:count:${input.daily_packs.length}/7`);
    }
    const dates = new Set<string>();
    input.daily_packs.forEach((candidate, index) => {
      const path = `solo_gist.daily_packs[${index}]`;
      const pack = asRecord(candidate, path, issues);
      if (!pack) return;
      exactKeys(pack, ["date_wat", "question_ids"], path, issues);
      const dateWat = requiredString(pack, "date_wat", path, issues, 10);
      const questionIDsForDay = stringArray(
        pack.question_ids,
        `${path}.question_ids`,
        issues,
        SOLO_DAILY_COUNT,
      );
      const expectedDate = Number.isFinite(effectiveFromMs)
        ? watDateKey(effectiveFromMs + index * DAY_MS)
        : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateWat)) issues.push(`${path}.date_wat:invalid`);
      if (expectedDate && dateWat !== expectedDate) {
        issues.push(`${path}.date_wat:expected:${expectedDate}`);
      }
      if (dates.has(dateWat)) issues.push(`${path}.date_wat:duplicate`);
      dates.add(dateWat);
      if (!uniqueNormalized(questionIDsForDay)) issues.push(`${path}.question_ids:duplicates`);

      const categories = new Set<string>();
      for (const questionID of questionIDsForDay) {
        if (!quickPlaySet.has(questionID)) {
          issues.push(`${path}.question_ids:not_in_quick_play:${questionID}`);
        }
        const question = questionByID.get(questionID);
        if (question) categories.add(normalized(question.category));
      }
      if (categories.size < 3) issues.push(`${path}.question_ids:category_mix_below_3`);
      dailyPacks.push({ date_wat: dateWat, question_ids: questionIDsForDay });
    });
  }

  return {
    schema_version: schemaVersion,
    content_version: contentVersion,
    effective_week_wat: effectiveWeekWat,
    questions,
    quick_play_question_ids: quickPlayIDs,
    daily_packs: dailyPacks,
  };
}

function parseSponsor(
  value: unknown,
  issues: string[],
): PreparedSponsorConfiguration | null {
  if (value === undefined || value === null) return null;
  const sponsor = asRecord(value, "sponsor", issues);
  if (!sponsor) return null;
  exactKeys(sponsor, ["kind", "sponsor_name", "message"], "sponsor", issues);
  const kind = requiredString(sponsor, "kind", "sponsor", issues, 20);
  const sponsorName = requiredString(
    sponsor,
    "sponsor_name",
    "sponsor",
    issues,
    64,
  ).replace(/\s+/g, " ");
  const message = optionalString(sponsor, "message", "sponsor", issues, 180);
  if (kind !== "commercial" && kind !== "prizeFunding") {
    issues.push("sponsor.kind:invalid");
    return null;
  }
  return { kind, sponsorName, message };
}

export async function validateAndPrepareContentRelease(
  value: unknown,
): Promise<ContentReleaseValidation> {
  const issues: string[] = [];
  const input = asRecord(value, "release", issues);
  if (!input) return { issues };
  exactKeys(
    input,
    [
      "schema_version",
      "release_id",
      "revision",
      "effective_week_wat",
      "effective_from_wat",
      "expires_at_wat",
      "minimum_app_version",
      "sponsor",
      "party_deck",
      "solo_gist",
    ],
    "release",
    issues,
  );

  const schemaVersion = requiredInteger(input, "schema_version", "release", issues);
  const id = requiredString(input, "release_id", "release", issues, 80);
  const revision = requiredInteger(input, "revision", "release", issues);
  const minimumAppVersion = requiredString(
    input,
    "minimum_app_version",
    "release",
    issues,
    40,
  );
  if (schemaVersion !== REMOTE_CONTENT_SCHEMA_VERSION) {
    issues.push(`release.schema_version:unsupported:${schemaVersion}`);
  }
  if (!validVersion(id)) issues.push("release.release_id:invalid");
  if (revision <= 0) issues.push("release.revision:positive_required");
  if (!validSemver(minimumAppVersion)) issues.push("release.minimum_app_version:invalid_semver");

  const schedule = parseSchedule(input, issues);
  const sponsor = parseSponsor(input.sponsor, issues);
  const partyDeck = parsePartyDeck(input.party_deck, issues);
  const soloGist = parseSoloGist(
    input.solo_gist,
    schedule.effectiveWeekWat,
    schedule.effectiveFromMs,
    issues,
  );

  if (issues.length > 0 || !partyDeck || !soloGist) {
    return { issues: [...new Set(issues)].sort() };
  }

  const partyPayloadJson = canonicalJson(partyDeck);
  const soloPayloadJson = canonicalJson(soloGist);
  const encoder = new TextEncoder();
  const partyAsset: PreparedContentAsset = {
    kind: PARTY_DECK_KIND,
    contentVersion: partyDeck.content_version,
    sha256: await sha256Hex(partyPayloadJson),
    byteCount: encoder.encode(partyPayloadJson).byteLength,
    itemCount: partyDeck.cards.length,
    payloadJson: partyPayloadJson,
  };
  const soloAsset: PreparedContentAsset = {
    kind: SOLO_GIST_KIND,
    contentVersion: soloGist.content_version,
    sha256: await sha256Hex(soloPayloadJson),
    byteCount: encoder.encode(soloPayloadJson).byteLength,
    itemCount: soloGist.questions.length,
    payloadJson: soloPayloadJson,
  };

  return {
    issues: [],
    release: {
      id,
      revision,
      schemaVersion,
      effectiveWeekWat: schedule.effectiveWeekWat,
      effectiveFromMs: schedule.effectiveFromMs,
      expiresAtMs: schedule.expiresAtMs,
      effectiveFromWat: schedule.effectiveFromWat,
      expiresAtWat: schedule.expiresAtWat,
      minimumAppVersion,
      sponsor,
      assets: [partyAsset, soloAsset],
    },
  };
}
