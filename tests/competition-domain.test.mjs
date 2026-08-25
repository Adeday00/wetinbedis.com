import assert from "node:assert/strict";
import test from "node:test";

import {
  CompetitionDomainError,
  publicCompetitionCard,
  rankLeaderboard,
  scoreSubmission,
  validateCompetitionPack,
} from "../worker/api/domain.ts";

function makeCard(position, difficulty = "standard") {
  return {
    id: `card-${position}`,
    position,
    contentVersion: "content-v1",
    category: "Food",
    answerFamily: "Nigerian soups",
    clues: ["Often served warm", "Common at celebrations", "Made with local ingredients"],
    correctOptionId: `card-${position}-option-1`,
    difficulty,
    editorialStatus: "approved",
    voidedAt: null,
    options: Array.from({ length: 7 }, (_, index) => ({
      id: `card-${position}-option-${index + 1}`,
      label: index === 0 ? `Correct dish ${position}` : `Distractor ${position}-${index}`,
      category: "Food",
      answerFamily: "Nigerian soups",
      position: index + 1,
    })),
  };
}

function perfectAnswers(cards, responseMs) {
  return cards.map((card) => ({
    cardId: card.id,
    position: card.position,
    selectedOptionId: card.correctOptionId,
    responseMs,
  }));
}

test("editorial gate rejects displaced categories and answer families", () => {
  const cards = [makeCard(1)];
  assert.deepEqual(validateCompetitionPack(cards, 1), []);

  cards[0].options[2].category = "Slang";
  cards[0].options[3].answerFamily = "Street expressions";
  const issues = validateCompetitionPack(cards, 1);
  assert.ok(issues.includes("displaced_category:card-1:card-1-option-3"));
  assert.ok(issues.includes("displaced_answer_family:card-1:card-1-option-4"));
});

test("pack issue codes never echo private duplicate option text", () => {
  const card = makeCard(1);
  card.options[3].label = card.options[0].label;
  const issues = validateCompetitionPack([card], 1);

  assert.ok(issues.includes("duplicate_option_label:card-1:card-1-option-4"));
  assert.doesNotMatch(JSON.stringify(issues), /correct dish/i);
});

test("public card payload never exposes the private answer key or family", () => {
  const payload = publicCompetitionCard(makeCard(1), 12_000);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /correctOptionId|correct_option_id/);
  assert.doesNotMatch(serialized, /answerFamily|answer_family/);
  assert.equal(payload.options.length, 7);
  assert.equal(payload.time_limit_ms, 12_000);
});

test("server recomputes 12/12 and uses speed as the deciding field", () => {
  const cards = Array.from({ length: 12 }, (_, index) =>
    makeCard(index + 1, index >= 9 ? "hard" : "standard"),
  );
  const fast = scoreSubmission({
    cards,
    answers: perfectAnswers(cards, 900),
    perCardLimitMs: 12_000,
    serverElapsedMs: 12_000,
    uploadGraceMs: 15_000,
  });
  const slower = scoreSubmission({
    cards,
    answers: perfectAnswers(cards, 1_000),
    perCardLimitMs: 12_000,
    serverElapsedMs: 13_000,
    uploadGraceMs: 15_000,
  });

  assert.equal(fast.correctCount, 12);
  assert.equal(slower.correctCount, 12);
  assert.equal(fast.adjustedTotalMs, 10_800);
  assert.equal(slower.adjustedTotalMs, 12_000);

  const ranked = rankLeaderboard([
    {
      attemptId: "slow",
      publicHandle: "GIST-SLOW",
      correctCount: 12,
      adjustedTotalMs: slower.adjustedTotalMs,
      hardCardMs: slower.hardCardMs,
      scoreStatus: "provisional",
    },
    {
      attemptId: "fast",
      publicHandle: "GIST-FAST",
      correctCount: 12,
      adjustedTotalMs: fast.adjustedTotalMs,
      hardCardMs: fast.hardCardMs,
      scoreStatus: "provisional",
    },
  ]);

  assert.equal(ranked[0].attemptId, "fast");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
});

test("exact score and timing ties share rank", () => {
  const base = {
    correctCount: 12,
    adjustedTotalMs: 9_500,
    hardCardMs: 2_200,
    scoreStatus: "confirmed",
  };
  const ranked = rankLeaderboard([
    { ...base, attemptId: "b", publicHandle: "GIST-B" },
    { ...base, attemptId: "a", publicHandle: "GIST-A" },
    {
      ...base,
      attemptId: "c",
      publicHandle: "GIST-C",
      adjustedTotalMs: 9_700,
    },
  ]);

  assert.deepEqual(
    ranked.map(({ rank, tieSize }) => [rank, tieSize]),
    [
      [1, 2],
      [1, 2],
      [3, 1],
    ],
  );
});

test("a missed card is wrong even if a client would label it correct", () => {
  const cards = [makeCard(1)];
  const score = scoreSubmission({
    cards,
    answers: [
      {
        cardId: "card-1",
        position: 1,
        selectedOptionId: null,
        responseMs: 12_000,
      },
    ],
    perCardLimitMs: 12_000,
    serverElapsedMs: 13_000,
    uploadGraceMs: 15_000,
  });

  assert.equal(score.correctCount, 0);
  assert.equal(score.answers[0].isCorrect, false);
});

test("every wrong answer receives the full per-card time penalty", () => {
  const cards = [makeCard(1), makeCard(2, "hard")];
  const fastWrong = scoreSubmission({
    cards,
    answers: cards.map((card) => ({
      cardId: card.id,
      position: card.position,
      selectedOptionId: `${card.id}-option-2`,
      responseMs: 200,
    })),
    perCardLimitMs: 12_000,
    serverElapsedMs: 1_000,
    uploadGraceMs: 15_000,
  });
  const slowWrong = scoreSubmission({
    cards,
    answers: cards.map((card) => ({
      cardId: card.id,
      position: card.position,
      selectedOptionId: `${card.id}-option-3`,
      responseMs: 11_500,
    })),
    perCardLimitMs: 12_000,
    serverElapsedMs: 24_000,
    uploadGraceMs: 15_000,
  });

  assert.equal(fastWrong.clientActiveMs, 400);
  assert.equal(slowWrong.clientActiveMs, 23_000);
  assert.equal(fastWrong.adjustedTotalMs, 24_000);
  assert.equal(slowWrong.adjustedTotalMs, 24_000);
  assert.equal(fastWrong.hardCardMs, 12_000);
  assert.equal(slowWrong.hardCardMs, 12_000);
});

test("unknown options and fabricated response times are rejected", () => {
  const cards = [makeCard(1)];
  assert.throws(
    () =>
      scoreSubmission({
        cards,
        answers: [
          {
            cardId: "card-1",
            position: 1,
            selectedOptionId: "made-up-option",
            responseMs: 100,
          },
        ],
        perCardLimitMs: 12_000,
        serverElapsedMs: 500,
        uploadGraceMs: 15_000,
      }),
    (error) =>
      error instanceof CompetitionDomainError && error.code === "unknown_option",
  );
});
