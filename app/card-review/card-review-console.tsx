"use client";

import { useEffect, useMemo, useState } from "react";

type Difficulty = "Easy" | "Medium" | "Hard";
type Card = {
  "Card Number": number;
  ID: string;
  Difficulty: Difficulty;
  Category: string;
  "Main Word": string;
  "Forbidden Word 1": string;
  "Forbidden Word 2": string;
  "Forbidden Word 3": string;
};
type Notice = { tone: "good" | "bad" | "neutral"; title: string; detail?: string };

const categories = ["All", "Celebrities", "Culture", "Diaspora", "Food", "Music", "Naija Life", "Religion", "School", "Slang", "Street & Hustle"];
const difficulties = ["All", "Easy", "Medium", "Hard"];

function cloneCards(cards: Card[]): Card[] {
  return cards.map((card) => ({ ...card }));
}

export function CardReviewConsole() {
  const [cards, setCards] = useState<Card[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [category, setCategory] = useState("All");
  const [difficulty, setDifficulty] = useState("All");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);

  async function loadCards() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/admin/party-deck", { credentials: "same-origin" });
      const payload = await response.json() as { cards?: Card[]; updated_at?: number | null; error?: { message?: string } };
      if (!response.ok || !Array.isArray(payload.cards)) throw new Error(payload.error?.message ?? "The cards could not be loaded.");
      setCards(cloneCards(payload.cards));
      setUpdatedAt(payload.updated_at ?? null);
      setDirty(false);
    } catch (error) {
      setNotice({ tone: "bad", title: "Cards did not load", detail: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadCards(); }, []);

  const filteredCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return cards.filter((card) => {
      if (category !== "All" && card.Category !== category) return false;
      if (difficulty !== "All" && card.Difficulty !== difficulty) return false;
      if (!needle) return true;
      return [card.ID, card.Category, card["Main Word"], card["Forbidden Word 1"], card["Forbidden Word 2"], card["Forbidden Word 3"]]
        .join(" ").toLocaleLowerCase().includes(needle);
    });
  }, [cards, category, difficulty, query]);

  function updateCard(cardNumber: number, field: keyof Card, value: string) {
    setCards((current) => current.map((card) => card["Card Number"] === cardNumber ? { ...card, [field]: field === "Difficulty" ? value as Difficulty : value } : card));
    setDirty(true);
    setNotice(null);
  }

  async function saveCards() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/admin/party-deck", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cards, expected_updated_at: updatedAt }),
      });
      const payload = await response.json() as { cards?: Card[]; updated_at?: number; issues?: string[]; error?: { message?: string } };
      if (!response.ok || !Array.isArray(payload.cards)) {
        const detail = payload.issues?.slice(0, 8).join(" · ") || payload.error?.message || "The changes were rejected.";
        throw new Error(detail);
      }
      setCards(cloneCards(payload.cards));
      setUpdatedAt(payload.updated_at ?? null);
      setDirty(false);
      setNotice({ tone: "good", title: "Saved", detail: "Your card edits are now stored on the Site." });
    } catch (error) {
      setNotice({ tone: "bad", title: "Not saved", detail: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(cards, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "wetin-be-dis-party-deck-edits.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card-review-console" aria-busy={busy}>
      <div className="review-toolbar">
        <div className="review-stat"><strong>{cards.length}</strong><span>total cards</span></div>
        <div className="review-stat"><strong>{filteredCards.length}</strong><span>showing</span></div>
        <label className="review-search">Search cards
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Answer, ID, or forbidden word" />
        </label>
        <label>Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label>Difficulty
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{difficulties.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
      </div>

      <div className="review-actions">
        <button className="button button-primary" onClick={() => void saveCards()} disabled={busy || !dirty}>{busy ? "Working…" : "Save all changes"}</button>
        <button className="button button-secondary" onClick={() => void loadCards()} disabled={busy}>Reload saved version</button>
        <button className="button button-secondary" onClick={downloadBackup} disabled={busy || cards.length === 0}>Download backup</button>
        {dirty && <span className="review-dirty">Unsaved changes</span>}
      </div>

      {notice && <div className={`admin-notice ${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}><strong>{notice.title}</strong>{notice.detail && <p>{notice.detail}</p>}</div>}

      <div className="card-review-list">
        {filteredCards.map((card) => (
          <article className="review-card" key={card.ID}>
            <div className="review-card-heading"><span className="review-number">#{card["Card Number"]}</span><span className="review-id">{card.ID}</span></div>
            <label>Answer<input value={card["Main Word"]} onChange={(event) => updateCard(card["Card Number"], "Main Word", event.target.value)} /></label>
            <div className="review-two-up">
              <label>Category<select value={card.Category} onChange={(event) => updateCard(card["Card Number"], "Category", event.target.value)}>{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Difficulty<select value={card.Difficulty} onChange={(event) => updateCard(card["Card Number"], "Difficulty", event.target.value)}><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
            </div>
            <fieldset><legend>Forbidden words</legend>
              {[1, 2, 3].map((number) => {
                const field = `Forbidden Word ${number}` as keyof Card;
                return <label key={field}>#{number}<input value={card[field] as string} onChange={(event) => updateCard(card["Card Number"], field, event.target.value)} /></label>;
              })}
            </fieldset>
          </article>
        ))}
      </div>
      {!busy && filteredCards.length === 0 && <div className="review-empty">No cards match those filters.</div>}
    </section>
  );
}
