"use client";

import { useMemo, useState } from "react";

type Candidate = {
  id: string;
  answer: string;
  category: string;
  difficulty: string;
  clues: string[];
  distractors: string[];
  final_qc: string;
};

const categories = ["All", "Celebrities", "Culture", "Diaspora", "Food", "Music", "Naija Life", "Religion", "School", "Slang", "Street & Hustle"];

export function SoloCandidateBrowser({ candidates }: { candidates: Candidate[] }) {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [expandedID, setExpandedID] = useState<string | null>(null);
  const visibleCandidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return candidates.filter((candidate) => {
      if (category !== "All" && candidate.category !== category) return false;
      return !needle || [candidate.id, candidate.answer, candidate.category, ...candidate.clues, ...candidate.distractors].join(" ").toLocaleLowerCase().includes(needle);
    });
  }, [candidates, category, query]);

  return <section className="solo-candidate-browser">
    <div className="candidate-toolbar">
      <div className="review-stat"><strong>{candidates.length}</strong><span>draft cards</span></div>
      <div className="review-stat"><strong>{visibleCandidates.length}</strong><span>showing</span></div>
      <label className="review-search">Search candidates<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Answer, ID, clue, or option" /></label>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
    <p className="candidate-review-note">These are unpublished editorial drafts. A card needs an owner review of its clues and option family before it can enter Today’s 5.</p>
    <div className="candidate-card-list">
      {visibleCandidates.map((candidate) => {
        const expanded = expandedID === candidate.id;
        return <article className="candidate-card" key={candidate.id}>
          <div className="candidate-card-heading"><span className="review-id">{candidate.id}</span><span className="candidate-status">{candidate.final_qc}</span></div>
          <p className="candidate-category">{candidate.category} · {candidate.difficulty}</p>
          <h2>{candidate.answer}</h2>
          <ol className="candidate-clues">{candidate.clues.map((clue) => <li key={clue}>{clue}</li>)}</ol>
          <button className="candidate-options-toggle" onClick={() => setExpandedID(expanded ? null : candidate.id)} aria-expanded={expanded}>{expanded ? "Hide answer options" : "Show answer options"}</button>
          {expanded && <ol className="candidate-options"><li><strong>{candidate.answer}</strong></li>{candidate.distractors.map((option) => <li key={option}>{option}</li>)}</ol>}
        </article>;
      })}
    </div>
    {visibleCandidates.length === 0 && <div className="review-empty">No candidate cards match that search.</div>}
  </section>;
}
