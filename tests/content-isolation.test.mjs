import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateCompetitionIsolation } from "../worker/api/content-isolation.ts";

function competitionCard(overrides = {}) {
  return {
    id: "league-private-1",
    sourceCardId: "league-source-1",
    position: 1,
    contentVersion: "league-v1",
    category: "Food",
    answerFamily: "Private league family",
    clues: ["Private broad clue", "Private middle clue", "Private final clue"],
    correctOptionId: "league-private-1-option-1",
    difficulty: "standard",
    editorialStatus: "approved",
    voidedAt: null,
    options: Array.from({ length: 7 }, (_, index) => ({
      id: `league-private-1-option-${index + 1}`,
      label: index === 0 ? "Private answer" : `Private distractor ${index + 1}`,
      category: "Food",
      answerFamily: "Private league family",
      position: index + 1,
    })),
    ...overrides,
  };
}

const publicSource = {
  partyDeck: {
    cards: [
      {
        id: "PARTY-001",
        main_word: "Public Party Answer",
        forbidden_words: ["Public party clue", "Second clue", "Third clue"],
      },
    ],
  },
  soloGist: {
    questions: [
      {
        id: "SG-002",
        correct_option_id: "SG-002-option-1",
        clues: ["Public Solo clue", "Another public clue", "Last public clue"],
        options: [
          { id: "SG-002-option-1", label: "Sapa" },
          { id: "SG-002-option-2", label: "Wahala" },
        ],
      },
    ],
  },
};

test("competition isolation detects normalized source IDs, correct answers, and clues", () => {
  const cards = [
    competitionCard({ sourceCardId: " sg-002 " }),
    competitionCard({
      id: "league-private-2",
      sourceCardId: "league-source-2",
      options: [
        {
          id: "league-private-2-option-1",
          label: "SAPA",
          category: "Food",
          answerFamily: "Private league family",
          position: 1,
        },
      ],
      correctOptionId: "league-private-2-option-1",
    }),
    competitionCard({
      id: "league-private-3",
      sourceCardId: "league-source-3",
      clues: ["  Public   Solo clue ", "Different", "Still different"],
    }),
  ];

  const issues = validateCompetitionIsolation(cards, [publicSource]);

  assert.deepEqual(issues, [
    "public_content_answer_overlap:league-private-2",
    "public_content_clue_overlap:league-private-3",
    "public_content_id_overlap:league-private-1",
  ]);
  assert.doesNotMatch(JSON.stringify(issues), /sapa|public solo clue|wahala/i);
});

test("competition isolation does not reject a shared distractor label", () => {
  const card = competitionCard();
  card.options[4].label = "Sapa";
  assert.deepEqual(validateCompetitionIsolation([card], [publicSource]), []);
});

test("competition isolation accepts a fully private pack", () => {
  assert.deepEqual(validateCompetitionIsolation([competitionCard()], [publicSource]), []);
});

test("competition card IDs are checked even when source IDs differ", () => {
  const card = competitionCard({ id: "PARTY-001", sourceCardId: "private-source" });
  assert.deepEqual(validateCompetitionIsolation([card], [publicSource]), [
    "public_content_id_overlap:PARTY-001",
  ]);
});

test("checked-in practice mirror matches every shipped Swift practice key", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("../content/competition-practice-fixture.json", import.meta.url), "utf8"),
  );
  const swift = await readFile(
    new URL("../../WetinBeDis/Competition/CompetitionDemoContent.swift", import.meta.url),
    "utf8",
  );
  const seeds = swift.slice(swift.indexOf("private static let seeds"));
  assert.equal(fixture.cards.length, 12);
  assert.equal((seeds.match(/id: "GL-/g) ?? []).length, 12);
  for (const card of fixture.cards) {
    assert.ok(seeds.includes(`id: "${card.id}"`));
    assert.ok(seeds.includes(`answer: "${card.correct_answer}"`));
    for (const clue of card.clues) assert.ok(seeds.includes(`"${clue}"`));
  }
});

test("shipped practice answers and clues are permanent cash-isolation fingerprints", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("../content/competition-practice-fixture.json", import.meta.url), "utf8"),
  );
  const answerCollision = competitionCard({
    id: "private-answer-collision",
    sourceCardId: "private-answer-source",
    correctOptionId: "private-answer-collision-option-1",
    options: [
      {
        id: "private-answer-collision-option-1",
        label: "Okra Soup",
        category: "Food",
        answerFamily: "Private league family",
        position: 1,
      },
    ],
  });
  const clueCollision = competitionCard({
    id: "private-clue-collision",
    sourceCardId: "private-clue-source",
    clues: [
      "Chopped okra pods are the defining ingredient.",
      "Private middle clue",
      "Private final clue",
    ],
  });
  const issues = validateCompetitionIsolation(
    [answerCollision, clueCollision],
    [{ practiceCompetition: fixture }],
  );
  assert.deepEqual(issues, [
    "public_content_answer_overlap:private-answer-collision",
    "public_content_clue_overlap:private-clue-collision",
  ]);
});
