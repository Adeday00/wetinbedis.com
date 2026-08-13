"use client";

import { useEffect, useMemo, useState } from "react";

type Card = { word: string; forbidden: string[]; color: string; icon: string };

const decks: Record<string, Card[]> = {
  Slang: [
    { word: "JAPA", forbidden: ["VISA", "AIRPORT", "CANADA"], color: "green", icon: "❞" },
    { word: "SAPA", forbidden: ["ACCOUNT BALANCE", "BILLING", "END OF MONTH"], color: "green", icon: "❞" },
    { word: "WAHALA", forbidden: ["PALAVA", "POLICE", "FAMILY MEETING"], color: "green", icon: "❞" },
  ],
  "Naija Life": [
    { word: "NEPA", forbidden: ["LIGHT", "OFF", "ELECTRICITY"], color: "gold", icon: "ϟ" },
    { word: "OWAMBE", forbidden: ["PARTY", "WEDDING", "ASO EBI"], color: "gold", icon: "ϟ" },
    { word: "DANFO", forbidden: ["BUS", "LAGOS", "YELLOW"], color: "gold", icon: "ϟ" },
  ],
  Music: [
    { word: "AFROBEATS", forbidden: ["MUSIC", "NIGERIA", "DANCE"], color: "teal", icon: "♫" },
    { word: "BURNA BOY", forbidden: ["ODỌGWU", "GRAMMY", "OUTSIDE"], color: "teal", icon: "♫" },
    { word: "DAVIDO", forbidden: ["OBO", "30BG", "TIMELESS"], color: "teal", icon: "♫" },
  ],
  Diaspora: [
    { word: "CARE PACKAGE", forbidden: ["PARCEL", "FOODSTUFF", "NIGERIA"], color: "blue", icon: "✈" },
    { word: "TIME DIFFERENCE", forbidden: ["CLOCK", "HOURS", "CALL"], color: "blue", icon: "✈" },
    { word: "AIRPORT GOODBYE", forbidden: ["DEPARTURES", "HUG", "TEARS"], color: "blue", icon: "✈" },
  ],
  Food: [
    { word: "JOLLOF RICE", forbidden: ["PARTY", "TOMATO", "GHANA"], color: "orange", icon: "♨" },
    { word: "SUYA", forbidden: ["MEAT", "PEPPER", "NIGHT"], color: "orange", icon: "♨" },
    { word: "PUFF PUFF", forbidden: ["FRIED", "DOUGH", "ROUND"], color: "orange", icon: "♨" },
  ],
};

const categoryIcons: Record<string, string> = { Slang: "❞", "Naija Life": "ϟ", Music: "♫", Diaspora: "✈", Food: "♨" };

export default function GameDemo() {
  const [category, setCategory] = useState("Slang");
  const [cardIndex, setCardIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(30);
  const [playing, setPlaying] = useState(false);
  const [flash, setFlash] = useState<"correct" | "skip" | null>(null);
  const card = useMemo(() => decks[category][cardIndex % decks[category].length], [category, cardIndex]);

  useEffect(() => {
    if (!playing || time <= 0) return;
    const tick = window.setInterval(() => setTime((value) => value - 1), 1000);
    return () => window.clearInterval(tick);
  }, [playing, time]);

  useEffect(() => { if (time === 0) setPlaying(false); }, [time]);

  function pickCategory(next: string) {
    setCategory(next); setCardIndex(0); setScore(0); setTime(30); setPlaying(false); setFlash(null);
  }

  function start() { setTime(30); setScore(0); setCardIndex(0); setPlaying(true); setFlash(null); }

  function answer(correct: boolean) {
    if (!playing) return;
    if (correct) setScore((value) => value + 1);
    setFlash(correct ? "correct" : "skip");
    window.setTimeout(() => { setCardIndex((value) => value + 1); setFlash(null); }, 260);
  }

  return (
    <div className="demo-shell">
      <div className="demo-topline"><span>LIVE GAME DEMO</span><span className="demo-status"><i /> {playing ? "ROUND IN PLAY" : time === 0 ? "TIME!" : "READY"}</span></div>
      <div className="category-pills" role="tablist" aria-label="Choose a sample category">
        {Object.keys(decks).map((name) => (
          <button key={name} role="tab" aria-selected={category === name} className={category === name ? "active" : ""} onClick={() => pickCategory(name)}>
            <span>{categoryIcons[name]}</span>{name}
          </button>
        ))}
      </div>
      <div className="demo-stage">
        <div className="demo-score"><span>TIME</span><strong className={time <= 8 ? "urgent" : ""}>{String(time).padStart(2, "0")}</strong></div>
        <div className={`demo-card ${card.color} ${flash ?? ""}`}>
          <div className="card-category"><span>{card.icon}</span>{category}</div>
          <p>MAKE YOUR PEOPLE GUESS</p>
          <h3>{card.word}</h3>
          <div className="no-mention"><span>NO MENTION:</span>{card.forbidden.map((word) => <b key={word}>✕ {word}</b>)}</div>
        </div>
        <div className="demo-score right"><span>SCORE</span><strong>{score}</strong></div>
      </div>
      <div className="demo-actions">
        {!playing ? <button className="start-demo" onClick={start}>{time === 0 ? "PLAY AGAIN" : "START 30s ROUND"}<span>▶</span></button> : <>
          <button className="skip-demo" onClick={() => answer(false)}>SKIP <span>↓</span></button>
          <button className="correct-demo" onClick={() => answer(true)}>THEY GOT IT <span>↑</span></button>
        </>}
      </div>
      <p className="demo-hint">You give the clues. Your people shout the answer. Just don’t touch the forbidden words.</p>
    </div>
  );
}
