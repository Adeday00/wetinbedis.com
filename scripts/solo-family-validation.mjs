function normalized(value) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-NG")
    .replace(/\s+/g, " ");
}

/**
 * Family membership is editorial evidence attached to each option label. It
 * is deliberately separate from the question family so a release builder can
 * never make six distractors look reviewed by copying the target family onto
 * them. This validates evidence only; it never changes review state.
 */
export function validateOptionFamilyReviews(card, { required = false } = {}) {
  const issues = [];
  const reviews = card?.option_family_reviews;
  const expectedLabels = [card?.answer, ...(Array.isArray(card?.distractors) ? card.distractors : [])]
    .filter((label) => typeof label === "string" && label.trim());

  if (!Array.isArray(reviews)) {
    if (required) issues.push("option_family_reviews: seven explicit editorial reviews required");
    return { issues, byLabel: new Map() };
  }
  if (reviews.length !== 7) issues.push(`option_family_reviews: expected 7, received ${reviews.length}`);

  const byLabel = new Map();
  reviews.forEach((review, index) => {
    const path = `option_family_reviews[${index}]`;
    if (!review || typeof review !== "object" || Array.isArray(review)) {
      issues.push(`${path}: object required`);
      return;
    }
    const expectedKeys = new Set(["label", "category", "answer_family", "status"]);
    const keys = Object.keys(review);
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
      issues.push(`${path}: only label, category, answer_family and status are allowed`);
    }
    const label = typeof review.label === "string" ? review.label.trim() : "";
    const key = normalized(label);
    if (!label) issues.push(`${path}.label: required`);
    if (byLabel.has(key)) issues.push(`${path}.label: duplicate review`);
    if (review.category !== card?.category) issues.push(`${path}.category: question mismatch`);
    if (review.answer_family !== card?.answer_family) issues.push(`${path}.answer_family: question mismatch`);
    if (review.status !== "Pass") issues.push(`${path}.status: explicit Pass required`);
    if (label) byLabel.set(key, review);
  });

  const expected = new Set(expectedLabels.map(normalized));
  if (expected.size !== 7) issues.push("labels: answer and distractors must be seven unique labels");
  for (const label of expectedLabels) {
    if (!byLabel.has(normalized(label))) issues.push(`option_family_reviews: missing ${label}`);
  }
  for (const reviewLabel of byLabel.keys()) {
    if (!expected.has(reviewLabel)) issues.push(`option_family_reviews: unknown label ${reviewLabel}`);
  }
  return { issues, byLabel };
}

export function requireReviewedOptionFamilies(card) {
  const result = validateOptionFamilyReviews(card, { required: true });
  if (result.issues.length) {
    throw new Error(`${card?.id ?? "unknown"} family evidence failed: ${result.issues.join("; ")}`);
  }
  return result.byLabel;
}

export function normalizedOptionLabel(value) {
  return normalized(value);
}
