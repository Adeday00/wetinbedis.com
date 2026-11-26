"use client";

import { useMemo, useState } from "react";

type Candidate = {
  id: string;
  answer: string;
  category: string;
  difficulty: string;
  answer_family: string;
  clues: string[];
  distractors: string[];
  final_qc: string;
  option_family_reviews: Array<{ label: string; category: string; answer_family: string; status: string }>;
};

const categories = ["All", "Celebrities", "Culture", "Diaspora", "Food", "Music", "Naija Life", "Religion", "School", "Slang", "Street & Hustle"];
const preparedReleaseKey = "wbd.admin.prepared-content-release";
const dayMilliseconds = 86_400_000;
const watOffset = 3_600_000;

function watDate(milliseconds: number) {
  return new Date(milliseconds + watOffset).toISOString().slice(0, 10);
}

function watTimestamp(milliseconds: number) {
  return new Date(milliseconds + watOffset).toISOString().replace(".000Z", "+01:00");
}

function nextWATMonday() {
  const shifted = new Date(Date.now() + watOffset);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - ((shifted.getUTCDay() + 6) % 7) + 7);
  return shifted.toISOString().slice(0, 10);
}

function planWeek(groups: Map<string, CandidateQuestion[]>) {
  const names = [...groups.keys()].sort();
  const initial = names.map((name) => groups.get(name)?.length ?? 0);
  const memo = new Map<string, number[][] | null>();

  function solve(day: number, remaining: number[]): number[][] | null {
    if (day === 7) return [];
    const key = `${day}:${remaining.join(",")}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    const plans: number[][] = [];
    function enumerate(index: number, used: number, counts: number[]) {
      if (index === names.length) {
        if (used === 5 && counts.filter(Boolean).length >= 3) plans.push(counts);
        return;
      }
      for (let count = 0; count <= Math.min(2, remaining[index], 5 - used); count += 1) {
        enumerate(index + 1, used + count, [...counts, count]);
      }
    }
    enumerate(0, 0, []);
    plans.sort((left, right) => right.filter(Boolean).length - left.filter(Boolean).length);
    for (const plan of plans) {
      const next = remaining.map((count, index) => count - plan[index]);
      if (next.some((count) => count < 0)) continue;
      const rest = solve(day + 1, next);
      if (rest) {
        const result = [plan, ...rest];
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, null);
    return null;
  }

  return solve(0, initial);
}

type CandidateQuestion = {
  id: string;
  category: string;
  answer_family: string;
  clues: string[];
  options: Array<{ id: string; label: string; category: string; answer_family: string }>;
  correct_option_id: string;
  explanation: string;
};

function toQuestion(candidate: Candidate): CandidateQuestion {
  const familyByLabel = new Map(candidate.option_family_reviews.map((review) => [review.label, review]));
  const labels = [...candidate.distractors];
  const number = Number(candidate.id.replace(/\D/g, "")) || 1;
  const correctIndex = (number - 1) % 7;
  labels.splice(correctIndex, 0, candidate.answer);
  const options = labels.map((label, index) => {
    const family = familyByLabel.get(label);
    if (!family || family.status !== "Pass" || family.category !== candidate.category || family.answer_family !== candidate.answer_family) {
      throw new Error(`${candidate.id}: review all seven answer families as ${candidate.answer_family} in ${candidate.category} before staging.`);
    }
    return { id: `${candidate.id}-option-${index + 1}`, label, category: candidate.category, answer_family: family.answer_family };
  });
  return {
    id: candidate.id,
    category: candidate.category,
    answer_family: candidate.answer_family,
    clues: candidate.clues,
    options,
    correct_option_id: options[correctIndex].id,
    explanation: `${candidate.answer}: ${candidate.clues[2]}`,
  };
}

async function createRelease(candidates: Candidate[], approvedIDs: Set<string>) {
  const selected = candidates.filter((candidate) => approvedIDs.has(candidate.id));
  if (!selected.length) throw new Error("Review and select at least one candidate card first.");

  const response = await fetch("/api/v1/admin/content/catalog", { credentials: "same-origin", cache: "no-store" });
  const catalog = await response.json() as {
    solo?: { questions?: CandidateQuestion[]; question_bank?: CandidateQuestion[]; daily_packs?: Array<{ question_ids: string[] }> };
    party_deck?: { cards?: Array<Record<string, unknown>> };
    release?: { id: string; revision: number; schema_version: number; minimum_app_version: string } | null;
    error?: { message?: string };
  };
  if (!response.ok || !catalog.solo || !catalog.party_deck || !catalog.release) {
    throw new Error(catalog.error?.message ?? "Could not load the current published release and card catalog.");
  }

  const added = selected.map(toQuestion);
  const questionBank = catalog.solo.question_bank ?? catalog.solo.questions ?? [];
  const knownIDs = new Set(questionBank.map((question) => question.id));
  if (added.some((question) => knownIDs.has(question.id))) throw new Error("A selected candidate is already in the published question bank.");
  const questions = [...questionBank, ...added];
  const previouslyUsed = new Set((catalog.solo.daily_packs ?? []).flatMap((pack) => pack.question_ids));
  const pool = questions.filter((question) => !previouslyUsed.has(question.id));
  const groups = new Map<string, CandidateQuestion[]>();
  for (const question of pool) groups.set(question.category, [...(groups.get(question.category) ?? []), question]);
  for (const group of groups.values()) group.sort((left, right) => left.id.localeCompare(right.id));
  const plan = planWeek(groups);
  if (!plan) throw new Error("The reviewed bank cannot make seven fresh, category-balanced daily packs. Approve more cards across categories.");

  const week = nextWATMonday();
  const [year, month, day] = week.split("-").map(Number);
  const startsAt = Date.UTC(year, month - 1, day) - watOffset;
  const revision = catalog.release.revision + 1;
  const suffix = `${week.toLowerCase()}-r${revision}`;
  const dailyPacks = plan.map((dayPlan, dayIndex) => {
    const ids: string[] = [];
    dayPlan.forEach((count, categoryIndex) => {
      const category = [...groups.keys()].sort()[categoryIndex];
      const group = groups.get(category)!;
      for (let index = 0; index < count; index += 1) ids.push(group.shift()!.id);
    });
    return { date_wat: watDate(startsAt + dayIndex * dayMilliseconds), question_ids: ids };
  });

  const partyCards = (catalog.party_deck.cards ?? []).map((card) => ({
    card_number: Number(card["Card Number"]),
    id: String(card.ID),
    difficulty: String(card.Difficulty),
    category: String(card.Category),
    main_word: String(card["Main Word"]),
    forbidden_words: [String(card["Forbidden Word 1"]), String(card["Forbidden Word 2"]), String(card["Forbidden Word 3"])],
  }));
  return {
    schema_version: catalog.release.schema_version,
    release_id: `solo-admin-${suffix}`,
    revision,
    effective_week_wat: week,
    effective_from_wat: watTimestamp(startsAt),
    expires_at_wat: watTimestamp(startsAt + 7 * dayMilliseconds),
    minimum_app_version: catalog.release.minimum_app_version,
    party_deck: { schema_version: 1, content_version: `party-${suffix}`, cards: partyCards },
    solo_gist: {
      schema_version: 1,
      content_version: `solo-${suffix}`,
      effective_week_wat: week,
      questions,
      quick_play_question_ids: questions.map((question) => question.id),
      daily_packs: dailyPacks,
    },
  };
}

export function SoloCandidateBrowser({ candidates }: { candidates: Candidate[] }) {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [expandedID, setExpandedID] = useState<string | null>(null);
  const [approvedIDs, setApprovedIDs] = useState<Set<string>>(new Set());
  const [reviewedOptionIDs, setReviewedOptionIDs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const visibleCandidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return candidates.filter((candidate) => {
      if (category !== "All" && candidate.category !== category) return false;
      return !needle || [candidate.id, candidate.answer, candidate.category, ...candidate.clues, ...candidate.distractors].join(" ").toLocaleLowerCase().includes(needle);
    });
  }, [candidates, category, query]);

  function toggleApproval(candidate: Candidate) {
    setApprovedIDs((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
  }

  async function stageRelease() {
    setBusy(true);
    setMessage("");
    try {
      const release = await createRelease(candidates, approvedIDs);
      sessionStorage.setItem(preparedReleaseKey, JSON.stringify(release));
      window.location.assign("/content-admin");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare a release from these candidates.");
      setBusy(false);
    }
  }

  return <section className="solo-candidate-browser">
    <div className="candidate-toolbar">
      <div className="review-stat"><strong>{candidates.length}</strong><span>draft cards</span></div>
      <div className="review-stat"><strong>{approvedIDs.size}</strong><span>owner reviewed</span></div>
      <label className="review-search">Search candidates<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Answer, ID, clue, or option" /></label>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
    <p className="candidate-review-note">Every draft starts on editorial hold. Read the clues and all seven options, then mark each card you approve. The next step builds a scheduled release and runs the server checks before publishing.</p>
    <div className="candidate-card-list">
      {visibleCandidates.map((candidate) => {
        const expanded = expandedID === candidate.id;
        const approved = approvedIDs.has(candidate.id);
        const reviewedOptions = reviewedOptionIDs.has(candidate.id);
        return <article className="candidate-card" key={candidate.id}>
          <div className="candidate-card-heading"><span className="review-id">{candidate.id}</span><span className="candidate-status">{approved ? "OWNER APPROVED" : candidate.final_qc}</span></div>
          <p className="candidate-category">{candidate.category} · {candidate.difficulty}</p>
          <h2>{candidate.answer}</h2>
          <ol className="candidate-clues">{candidate.clues.map((clue) => <li key={clue}>{clue}</li>)}</ol>
          <button className="candidate-options-toggle" onClick={() => {
            setExpandedID(expanded ? null : candidate.id);
            if (!expanded) setReviewedOptionIDs((current) => new Set(current).add(candidate.id));
          }} aria-expanded={expanded}>{expanded ? "Hide answer options" : "Review all answer options"}</button>
          {expanded && <ol className="candidate-options">{[candidate.answer, ...candidate.distractors].map((option) => {
            const family = candidate.option_family_reviews.find((review) => review.label === option);
            return <li key={option}><strong>{option}</strong><span> · {family?.category ?? "No category"} / {family?.answer_family ?? "No family"} / {family?.status ?? "Unreviewed"}</span></li>;
          })}</ol>}
          <label className="admin-confirm" style={{ display: "flex", marginTop: 14 }}>
            <input type="checkbox" checked={approved} disabled={!reviewedOptions} onChange={() => toggleApproval(candidate)} />
            {reviewedOptions ? "I reviewed the clues and all seven options; approve this card for the next release." : "Open and review all seven options before approving this card."}
          </label>
        </article>;
      })}
    </div>
    {visibleCandidates.length === 0 && <div className="review-empty">No candidate cards match that search.</div>}
    <div className="admin-actions" style={{ marginTop: 20 }}>
      <button className="button button-primary" onClick={() => void stageRelease()} disabled={busy || approvedIDs.size === 0}>
        {busy ? "Preparing scheduled release…" : `Continue with ${approvedIDs.size} approved card${approvedIDs.size === 1 ? "" : "s"}`}
      </button>
      <p className="admin-help">You’ll review the generated release, validate it, then confirm publishing in the content publisher.</p>
    </div>
    {message && <div className="admin-notice bad" role="alert"><strong>Could not prepare release</strong><p>{message}</p></div>}
  </section>;
}
