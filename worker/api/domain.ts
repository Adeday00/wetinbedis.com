export const API_VERSION = "2026-08-24";
export const SCORING_VERSION = "accuracy-time-v1";
export const EXPECTED_CLUE_COUNT = 3;
export const EXPECTED_OPTION_COUNT = 7;

export type CardOption = {
  id: string;
  label: string;
  category: string;
  answerFamily: string;
  position: number;
};

export type CompetitionCard = {
  id: string;
  sourceCardId?: string;
  position: number;
  contentVersion: string;
  category: string;
  answerFamily: string;
  clues: string[];
  correctOptionId: string;
  difficulty: "standard" | "hard";
  editorialStatus: string;
  voidedAt: number | null;
  options: CardOption[];
};

export type SubmittedAnswer = {
  cardId: string;
  position: number;
  selectedOptionId: string | null;
  responseMs: number;
};

/**
 * An answer measured by the competition service, not supplied by the client.
 *
 * This is deliberately a separate shape from `SubmittedAnswer`: a cash
 * attempt must never accept `responseMs` from a device. The issue and answer
 * timestamps are written by the service when it releases one card and when it
 * receives that card's selection (or records its deadline as a timeout).
 */
export type ServerTimedAnswer = {
  cardId: string;
  position: number;
  /// `null` means an intentional skip or a server-recorded timeout. Both are
  /// wrong and receive the same full-card scoring penalty.
  selectedOptionId: string | null;
  issuedAtMs: number;
  answeredAtMs: number;
};

export type ScoredAnswer = SubmittedAnswer & {
  isCorrect: boolean;
  answerVersion: string;
};

export type AttemptScore = {
  correctCount: number;
  clientActiveMs: number;
  adjustedTotalMs: number;
  hardCardMs: number;
  integrityFlags: string[];
  answers: ScoredAnswer[];
};

export type LeaderboardScore = {
  attemptId: string;
  publicHandle: string;
  correctCount: number;
  adjustedTotalMs: number;
  hardCardMs: number;
  scoreStatus: "provisional" | "confirmed";
};

export type RankedLeaderboardScore = LeaderboardScore & {
  rank: number;
  tieSize: number;
};

export type CompetitionPackConfiguration = {
  rulesVersion: string;
  packVersion: string;
  scoringVersion: string;
  questionCount: number;
  perCardLimitMs: number;
  uploadGraceMs: number;
};

export class CompetitionDomainError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CompetitionDomainError";
    this.code = code;
    this.details = details;
  }
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-NG")
    .replace(/\s+/g, " ");
}

/**
 * Stable private-pack snapshot used to pin an attempt to exactly the rules,
 * timing configuration, answer key, and option set served at start. This value
 * is hashed before storage and is never returned by a public endpoint.
 */
export function canonicalCompetitionPack(
  configuration: CompetitionPackConfiguration,
  cards: CompetitionCard[],
): string {
  return JSON.stringify({
    configuration,
    cards: [...cards]
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((card) => ({
        id: card.id,
        sourceCardId: card.sourceCardId ?? "",
        position: card.position,
        contentVersion: card.contentVersion,
        category: card.category,
        answerFamily: card.answerFamily,
        clues: card.clues,
        correctOptionId: card.correctOptionId,
        difficulty: card.difficulty,
        editorialStatus: card.editorialStatus,
        voidedAt: card.voidedAt,
        options: [...card.options]
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
          .map((option) => ({
            id: option.id,
            label: option.label,
            position: option.position,
            category: option.category,
            answerFamily: option.answerFamily,
          })),
      })),
  });
}

export function validateCompetitionPack(
  cards: CompetitionCard[],
  questionCount: number,
): string[] {
  const issues: string[] = [];

  if (cards.length !== questionCount) {
    issues.push(`pack_card_count:${cards.length}/${questionCount}`);
  }

  const cardIds = new Set<string>();
  const positions = new Set<number>();

  for (const card of cards) {
    if (cardIds.has(card.id)) issues.push(`duplicate_card_id:${card.id}`);
    if (positions.has(card.position)) {
      issues.push(`duplicate_card_position:${card.position}`);
    }
    cardIds.add(card.id);
    positions.add(card.position);

    if (card.editorialStatus !== "approved" || card.voidedAt !== null) {
      issues.push(`card_not_publishable:${card.id}`);
    }
    if (card.clues.length !== EXPECTED_CLUE_COUNT) {
      issues.push(`clue_count:${card.id}:${card.clues.length}`);
    }
    if (card.options.length !== EXPECTED_OPTION_COUNT) {
      issues.push(`option_count:${card.id}:${card.options.length}`);
    }

    const optionIds = new Set<string>();
    const optionLabels = new Set<string>();
    let correctOption: CardOption | undefined;

    for (const option of card.options) {
      const normalizedLabel = normalized(option.label);
      if (!normalizedLabel) issues.push(`blank_option_label:${card.id}`);
      if (optionIds.has(option.id)) {
        issues.push(`duplicate_option_id:${card.id}:${option.id}`);
      }
      if (optionLabels.has(normalizedLabel)) {
        // Public readiness/start/submit responses may include this controlled
        // issue code, so never echo private option or answer text here.
        issues.push(`duplicate_option_label:${card.id}:${option.id}`);
      }
      optionIds.add(option.id);
      optionLabels.add(normalizedLabel);

      if (option.category !== card.category) {
        issues.push(`displaced_category:${card.id}:${option.id}`);
      }
      if (option.answerFamily !== card.answerFamily) {
        issues.push(`displaced_answer_family:${card.id}:${option.id}`);
      }
      if (option.id === card.correctOptionId) correctOption = option;
    }

    if (!correctOption) {
      issues.push(`missing_correct_option:${card.id}`);
    } else {
      const answer = normalized(correctOption.label);
      for (const clue of card.clues) {
        if (answer.length >= 3 && normalized(clue).includes(answer)) {
          issues.push(`answer_leak_in_clue:${card.id}`);
          break;
        }
      }
    }
  }

  for (let position = 1; position <= questionCount; position += 1) {
    if (!positions.has(position)) issues.push(`missing_card_position:${position}`);
  }

  return issues;
}

export function publicCompetitionCard(
  card: CompetitionCard,
  perCardLimitMs: number,
) {
  return {
    id: card.id,
    position: card.position,
    content_version: card.contentVersion,
    category: card.category,
    clues: card.clues,
    options: [...card.options]
      .sort((left, right) => left.position - right.position)
      .map((option) => ({ id: option.id, label: option.label })),
    time_limit_ms: perCardLimitMs,
  };
}

export function scoreSubmission(input: {
  cards: CompetitionCard[];
  answers: SubmittedAnswer[];
  perCardLimitMs: number;
  serverElapsedMs: number;
  uploadGraceMs: number;
}): AttemptScore {
  const {
    cards,
    answers,
    perCardLimitMs,
    serverElapsedMs,
    uploadGraceMs,
  } = input;

  if (answers.length !== cards.length) {
    throw new CompetitionDomainError(
      "answer_count_mismatch",
      "Every competition card must have exactly one submitted result.",
      { expected: cards.length, received: answers.length },
    );
  }

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const seenCards = new Set<string>();
  const seenPositions = new Set<number>();
  const scoredAnswers: ScoredAnswer[] = [];
  const integrityFlags = new Set<string>();
  let correctCount = 0;
  let clientActiveMs = 0;
  let adjustedTotalMs = 0;
  let hardCardMs = 0;

  for (const answer of answers) {
    const card = cardsById.get(answer.cardId);
    if (!card) {
      throw new CompetitionDomainError(
        "unknown_card",
        "The submission contains a card outside this attempt.",
        { cardId: answer.cardId },
      );
    }
    if (seenCards.has(answer.cardId) || seenPositions.has(answer.position)) {
      throw new CompetitionDomainError(
        "duplicate_answer",
        "Each card and position may be submitted only once.",
        { cardId: answer.cardId, position: answer.position },
      );
    }
    if (answer.position !== card.position) {
      throw new CompetitionDomainError(
        "answer_position_mismatch",
        "The answer position does not match the signed competition pack.",
        { cardId: answer.cardId, expected: card.position, received: answer.position },
      );
    }
    if (
      !Number.isInteger(answer.responseMs) ||
      answer.responseMs < 0 ||
      answer.responseMs > perCardLimitMs
    ) {
      throw new CompetitionDomainError(
        "invalid_response_time",
        "Response time must be an integer within the per-card limit.",
        { cardId: answer.cardId, responseMs: answer.responseMs, perCardLimitMs },
      );
    }

    const optionIds = new Set(card.options.map((option) => option.id));
    if (
      answer.selectedOptionId !== null &&
      !optionIds.has(answer.selectedOptionId)
    ) {
      throw new CompetitionDomainError(
        "unknown_option",
        "The selected option is not part of this card.",
        { cardId: answer.cardId, optionId: answer.selectedOptionId },
      );
    }
    if (
      answer.selectedOptionId === null &&
      answer.responseMs !== perCardLimitMs
    ) {
      throw new CompetitionDomainError(
        "invalid_timeout",
        "An unanswered card must use the full per-card time limit.",
        { cardId: answer.cardId, responseMs: answer.responseMs, perCardLimitMs },
      );
    }

    const isCorrect = answer.selectedOptionId === card.correctOptionId;
    if (isCorrect) correctCount += 1;
    clientActiveMs += answer.responseMs;
    const adjustedResponseMs = isCorrect ? answer.responseMs : perCardLimitMs;
    adjustedTotalMs += adjustedResponseMs;
    if (card.difficulty === "hard") hardCardMs += adjustedResponseMs;
    if (answer.selectedOptionId !== null && answer.responseMs < 150) {
      integrityFlags.add("subhuman_response_time");
    }

    seenCards.add(answer.cardId);
    seenPositions.add(answer.position);
    scoredAnswers.push({
      ...answer,
      isCorrect,
      answerVersion: card.contentVersion,
    });
  }

  if (clientActiveMs > serverElapsedMs + 1000) {
    integrityFlags.add("client_time_exceeds_server_envelope");
  }
  if (serverElapsedMs > clientActiveMs + uploadGraceMs + 5000) {
    integrityFlags.add("server_time_exceeds_client_envelope");
  }

  scoredAnswers.sort((left, right) => left.position - right.position);

  return {
    correctCount,
    clientActiveMs,
    adjustedTotalMs,
    hardCardMs,
    integrityFlags: [...integrityFlags].sort(),
    answers: scoredAnswers,
  };
}

/**
 * Scores a sequential, server-timed attempt.
 *
 * This is the cash-League scoring primitive. It accepts only server-recorded
 * issue/answer timestamps and requires the issue order to exactly match the
 * private pack. The existing `scoreSubmission` remains for the non-cash
 * practice preview, where timing is explicitly marked untrusted.
 */
export function scoreServerTimedSubmission(input: {
  cards: CompetitionCard[];
  answers: ServerTimedAnswer[];
  perCardLimitMs: number;
}): AttemptScore {
  const { cards, answers, perCardLimitMs } = input;
  if (answers.length !== cards.length) {
    throw new CompetitionDomainError(
      "answer_count_mismatch",
      "Every competition card must have exactly one server-recorded result.",
      { expected: cards.length, received: answers.length },
    );
  }

  const orderedCards = [...cards].sort((left, right) => left.position - right.position);
  const scoredAnswers: ScoredAnswer[] = [];
  let correctCount = 0;
  let clientActiveMs = 0;
  let adjustedTotalMs = 0;
  let hardCardMs = 0;
  let previousAnsweredAtMs = -1;

  for (let index = 0; index < orderedCards.length; index += 1) {
    const card = orderedCards[index];
    const answer = answers[index];
    if (answer.cardId !== card.id || answer.position !== card.position) {
      throw new CompetitionDomainError(
        "server_timed_answer_order",
        "A cash attempt must answer each server-issued card in order.",
        {
          expectedCardId: card.id,
          expectedPosition: card.position,
          receivedCardId: answer.cardId,
          receivedPosition: answer.position,
        },
      );
    }
    if (
      !Number.isInteger(answer.issuedAtMs) ||
      !Number.isInteger(answer.answeredAtMs) ||
      answer.issuedAtMs < 0 ||
      answer.answeredAtMs < answer.issuedAtMs ||
      answer.issuedAtMs < previousAnsweredAtMs
    ) {
      throw new CompetitionDomainError(
        "invalid_server_timing",
        "Server-issued answer times must be monotonic millisecond timestamps.",
        { cardId: card.id },
      );
    }

    const measuredResponseMs = answer.answeredAtMs - answer.issuedAtMs;
    if (measuredResponseMs > perCardLimitMs) {
      throw new CompetitionDomainError(
        "server_timed_answer_expired",
        "A selected answer arrived after this card's server deadline.",
        { cardId: card.id, measuredResponseMs, perCardLimitMs },
      );
    }
    const optionIds = new Set(card.options.map((option) => option.id));
    if (answer.selectedOptionId !== null && !optionIds.has(answer.selectedOptionId)) {
      throw new CompetitionDomainError(
        "unknown_option",
        "The selected option is not part of this card.",
        { cardId: card.id, optionId: answer.selectedOptionId },
      );
    }

    const isCorrect = answer.selectedOptionId === card.correctOptionId;
    if (isCorrect) correctCount += 1;
    clientActiveMs += measuredResponseMs;
    const adjustedResponseMs = isCorrect ? measuredResponseMs : perCardLimitMs;
    adjustedTotalMs += adjustedResponseMs;
    if (card.difficulty === "hard") hardCardMs += adjustedResponseMs;
    scoredAnswers.push({
      cardId: answer.cardId,
      position: answer.position,
      selectedOptionId: answer.selectedOptionId,
      responseMs: measuredResponseMs,
      isCorrect,
      answerVersion: card.contentVersion,
    });
    previousAnsweredAtMs = answer.answeredAtMs;
  }

  return {
    correctCount,
    clientActiveMs,
    adjustedTotalMs,
    hardCardMs,
    integrityFlags: [],
    answers: scoredAnswers,
  };
}

export function compareLeaderboardScores(
  left: LeaderboardScore,
  right: LeaderboardScore,
): number {
  return (
    right.correctCount - left.correctCount ||
    left.adjustedTotalMs - right.adjustedTotalMs ||
    left.hardCardMs - right.hardCardMs
  );
}

function scoresAreExactTies(
  left: LeaderboardScore,
  right: LeaderboardScore,
): boolean {
  return compareLeaderboardScores(left, right) === 0;
}

export function rankLeaderboard(
  scores: LeaderboardScore[],
): RankedLeaderboardScore[] {
  const sorted = [...scores].sort(
    (left, right) =>
      compareLeaderboardScores(left, right) ||
      left.publicHandle.localeCompare(right.publicHandle, "en-NG") ||
      left.attemptId.localeCompare(right.attemptId),
  );

  const ranked = sorted.map((score, index) => ({
    ...score,
    rank:
      index > 0 && scoresAreExactTies(score, sorted[index - 1])
        ? 0
        : index + 1,
    tieSize: 1,
  }));

  let groupStart = 0;
  while (groupStart < ranked.length) {
    let groupEnd = groupStart + 1;
    while (
      groupEnd < ranked.length &&
      scoresAreExactTies(ranked[groupStart], ranked[groupEnd])
    ) {
      groupEnd += 1;
    }

    const rank = groupStart + 1;
    const tieSize = groupEnd - groupStart;
    for (let index = groupStart; index < groupEnd; index += 1) {
      ranked[index].rank = rank;
      ranked[index].tieSize = tieSize;
    }
    groupStart = groupEnd;
  }

  return ranked;
}

export function canonicalSubmission(
  attemptId: string,
  answers: SubmittedAnswer[],
): string {
  const ordered = [...answers]
    .sort((left, right) => left.position - right.position)
    .map((answer) => [
      answer.cardId,
      answer.position,
      answer.selectedOptionId,
      answer.responseMs,
    ]);
  return JSON.stringify([SCORING_VERSION, attemptId, ordered]);
}
