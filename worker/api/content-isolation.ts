import type { CompetitionCard } from "./domain";

type JsonRecord = Record<string, unknown>;

export type PublicContentDocuments = {
  partyDeck?: unknown;
  soloGist?: unknown;
  practiceCompetition?: unknown;
};

export type ContentFingerprintSet = {
  ids: Set<string>;
  answers: Set<string>;
  clues: Set<string>;
  cards: Set<string>;
};

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-NG")
    .replace(/\s+/g, " ");
}

function fingerprint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = normalized(value);
  return result || null;
}

function record(value: unknown): JsonRecord | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as JsonRecord)
    : null;
}

function add(target: Set<string>, value: unknown): void {
  const result = fingerprint(value);
  if (result) target.add(result);
}

function addClues(target: Set<string>, values: unknown): void {
  if (!Array.isArray(values)) return;
  const normalizedClues = values
    .map(fingerprint)
    .filter((value): value is string => Boolean(value));
  for (const clue of normalizedClues) target.add(clue);
  if (normalizedClues.length > 0) target.add(normalizedClues.join(" | "));
}

function addCard(
  target: Set<string>,
  answer: unknown,
  clues: unknown,
): void {
  const answerFingerprint = fingerprint(answer);
  if (!answerFingerprint || !Array.isArray(clues)) return;
  const clueFingerprints = clues
    .map(fingerprint)
    .filter((value): value is string => Boolean(value));
  if (clueFingerprints.length === 0) return;
  target.add(`${answerFingerprint} || ${clueFingerprints.join(" | ")}`);
}

export function publicContentFingerprints(
  sources: PublicContentDocuments[],
): ContentFingerprintSet {
  const fingerprints: ContentFingerprintSet = {
    ids: new Set(),
    answers: new Set(),
    clues: new Set(),
    cards: new Set(),
  };

  for (const source of sources) {
    const party = record(source.partyDeck);
    if (Array.isArray(party?.cards)) {
      for (const value of party.cards) {
        const card = record(value);
        if (!card) continue;
        add(fingerprints.ids, card.id);
        add(fingerprints.answers, card.main_word);
        addClues(fingerprints.clues, card.forbidden_words);
        addCard(fingerprints.cards, card.main_word, card.forbidden_words);
      }
    }

    const solo = record(source.soloGist);
    if (Array.isArray(solo?.questions)) {
      for (const value of solo.questions) {
        const question = record(value);
        if (!question) continue;
        add(fingerprints.ids, question.id);
        addClues(fingerprints.clues, question.clues);
        if (!Array.isArray(question.options)) continue;
        const correctOptionID = fingerprint(question.correct_option_id);
        const correctOption = question.options
          .map(record)
          .find((option) => option && fingerprint(option.id) === correctOptionID);
        if (!correctOption) continue;
        add(fingerprints.answers, correctOption.label);
        addCard(fingerprints.cards, correctOption.label, question.clues);
      }
    }

    const practice = record(source.practiceCompetition);
    if (Array.isArray(practice?.cards)) {
      for (const value of practice.cards) {
        const card = record(value);
        if (!card) continue;
        add(fingerprints.ids, card.id);
        add(fingerprints.answers, card.correct_answer);
        addClues(fingerprints.clues, card.clues);
        addCard(fingerprints.cards, card.correct_answer, card.clues);
      }
    }
  }
  return fingerprints;
}

export function competitionContentFingerprints(
  card: CompetitionCard,
): ContentFingerprintSet {
  const fingerprints: ContentFingerprintSet = {
    ids: new Set(),
    answers: new Set(),
    clues: new Set(),
    cards: new Set(),
  };
  add(fingerprints.ids, card.id);
  add(fingerprints.ids, card.sourceCardId);
  addClues(fingerprints.clues, card.clues);
  const correctOption = card.options.find(
    (option) => fingerprint(option.id) === fingerprint(card.correctOptionId),
  );
  if (correctOption) {
    add(fingerprints.answers, correctOption.label);
    addCard(fingerprints.cards, correctOption.label, card.clues);
  }
  return fingerprints;
}

/**
 * Cash competition packs must be disjoint from every piece of public game
 * content. Issues intentionally identify only the private card and collision
 * class; they never echo an answer, option, clue, or public payload value.
 */
export function validateCompetitionIsolation(
  cards: CompetitionCard[],
  publicSources: PublicContentDocuments[],
): string[] {
  const publicFingerprints = publicContentFingerprints(publicSources);
  const issues: string[] = [];
  for (const card of cards) {
    const competition = competitionContentFingerprints(card);
    if ([...competition.ids].some((value) => publicFingerprints.ids.has(value))) {
      issues.push(`public_content_id_overlap:${card.id}`);
    }
    if ([...competition.answers].some((value) => publicFingerprints.answers.has(value))) {
      issues.push(`public_content_answer_overlap:${card.id}`);
    }
    if ([...competition.clues].some((value) => publicFingerprints.clues.has(value))) {
      issues.push(`public_content_clue_overlap:${card.id}`);
    }
    if ([...competition.cards].some((value) => publicFingerprints.cards.has(value))) {
      issues.push(`public_content_card_overlap:${card.id}`);
    }
  }
  return [...new Set(issues)].sort();
}
