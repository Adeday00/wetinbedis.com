import assert from "node:assert/strict";
import test from "node:test";
import {
  requireReviewedOptionFamilies,
  validateOptionFamilyReviews,
} from "../scripts/solo-family-validation.mjs";

function card() {
  const labels = ["Sapa", "Shege", "Wahala", "God Abeg", "E Pain Me", "Gobe", "Shege Pro Max"];
  return {
    id: "SG-TEST",
    answer: labels[0],
    distractors: labels.slice(1),
    category: "Slang",
    answer_family: "Money-pressure slang",
    family_review: "Pass",
    final_qc: "READY",
    option_family_reviews: labels.map((label) => ({
      label,
      category: "Slang",
      answer_family: "Money-pressure slang",
      status: "Pass",
    })),
  };
}

test("requires separate passing family evidence for all seven option labels", () => {
  const reviewed = card();
  const result = requireReviewedOptionFamilies(reviewed);
  assert.equal(result.size, 7);
  assert.equal(result.get("sapa").answer_family, "Money-pressure slang");
});

test("does not manufacture missing distractor family evidence", () => {
  const unreviewed = card();
  delete unreviewed.option_family_reviews;
  assert.throws(
    () => requireReviewedOptionFamilies(unreviewed),
    /seven explicit editorial reviews required/,
  );
  assert.equal(unreviewed.option_family_reviews, undefined);
});

test("rejects copied, mismatched, duplicate, and unknown family records", () => {
  const wrongFamily = card();
  wrongFamily.option_family_reviews[1].answer_family = "Trouble/reaction slang";
  assert.match(validateOptionFamilyReviews(wrongFamily, { required: true }).issues.join("\n"), /question mismatch/);

  const wrongCategory = card();
  wrongCategory.option_family_reviews[2].category = "Food";
  assert.match(validateOptionFamilyReviews(wrongCategory, { required: true }).issues.join("\n"), /category: question mismatch/);

  const duplicate = card();
  duplicate.option_family_reviews[6].label = "Sapa";
  const duplicateIssues = validateOptionFamilyReviews(duplicate, { required: true }).issues.join("\n");
  assert.match(duplicateIssues, /duplicate review/);
  assert.match(duplicateIssues, /missing Shege Pro Max/);

  const unknownField = card();
  unknownField.option_family_reviews[0].editorial_note = "not part of the machine contract";
  assert.match(validateOptionFamilyReviews(unknownField, { required: true }).issues.join("\n"), /only label/);
});

test("a held card may stay unreviewed but cannot become publishable", () => {
  const held = card();
  held.family_review = "Hold";
  held.final_qc = "EDITORIAL HOLD";
  delete held.option_family_reviews;
  assert.deepEqual(validateOptionFamilyReviews(held).issues, []);
  assert.throws(() => requireReviewedOptionFamilies(held));
});
