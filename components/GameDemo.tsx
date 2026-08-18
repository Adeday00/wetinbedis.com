"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  AirplaneTilt,
  ArrowDown,
  ArrowUp,
  CookingPot,
  Lightning,
  MusicNotes,
  Play,
  Quotes,
  X,
  type IconProps,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

type Card = { word: string; forbidden: string[]; color: string };

const decks: Record<string, Card[]> = {
  Slang: [
    { word: "JAPA", forbidden: ["VISA", "AIRPORT", "CANADA"], color: "green" },
    { word: "SAPA", forbidden: ["ACCOUNT BALANCE", "BILLING", "END OF MONTH"], color: "green" },
    { word: "WAHALA", forbidden: ["PALAVA", "POLICE", "FAMILY MEETING"], color: "green" },
  ],
  "Naija Life": [
    { word: "NEPA", forbidden: ["LIGHT", "OFF", "ELECTRICITY"], color: "gold" },
    { word: "OWAMBE", forbidden: ["PARTY", "WEDDING", "ASO EBI"], color: "gold" },
    { word: "DANFO", forbidden: ["BUS", "LAGOS", "YELLOW"], color: "gold" },
  ],
  Music: [
    { word: "AFROBEATS", forbidden: ["MUSIC", "NIGERIA", "DANCE"], color: "teal" },
    { word: "BURNA BOY", forbidden: ["ODỌGWU", "GRAMMY", "OUTSIDE"], color: "teal" },
    { word: "DAVIDO", forbidden: ["OBO", "30BG", "TIMELESS"], color: "teal" },
  ],
  Diaspora: [
    { word: "CARE PACKAGE", forbidden: ["PARCEL", "FOODSTUFF", "NIGERIA"], color: "blue" },
    { word: "TIME DIFFERENCE", forbidden: ["CLOCK", "HOURS", "CALL"], color: "blue" },
    { word: "AIRPORT GOODBYE", forbidden: ["DEPARTURES", "HUG", "TEARS"], color: "blue" },
  ],
  Food: [
    { word: "JOLLOF RICE", forbidden: ["PARTY", "TOMATO", "GHANA"], color: "orange" },
    { word: "SUYA", forbidden: ["MEAT", "PEPPER", "NIGHT"], color: "orange" },
    { word: "PUFF PUFF", forbidden: ["FRIED", "DOUGH", "ROUND"], color: "orange" },
  ],
};

const categoryIcons: Record<string, ComponentType<IconProps>> = {
  Slang: Quotes,
  "Naija Life": Lightning,
  Music: MusicNotes,
  Diaspora: AirplaneTilt,
  Food: CookingPot,
};

const categoryNames = Object.keys(decks);

export default function GameDemo() {
  const [category, setCategory] = useState("Slang");
  const [cardIndex, setCardIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(30);
  const [playing, setPlaying] = useState(false);
  const [flash, setFlash] = useState<"correct" | "skip" | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const card = useMemo(() => decks[category][cardIndex % decks[category].length], [category, cardIndex]);
  const CategoryIcon = categoryIcons[category];

  useEffect(() => {
    if (!playing || time <= 0) return;
    const tick = window.setInterval(() => setTime((value) => value - 1), 1000);
    return () => window.clearInterval(tick);
  }, [playing, time]);

  useEffect(() => { if (time === 0) setPlaying(false); }, [time]);

  function pickCategory(next: string) {
    setCategory(next); setCardIndex(0); setScore(0); setTime(30); setPlaying(false); setFlash(null);
  }

  function moveCategoryFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % categoryNames.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + categoryNames.length) % categoryNames.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = categoryNames.length - 1;
    else return;
    event.preventDefault();
    pickCategory(categoryNames[next]);
    tabRefs.current[next]?.focus();
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
      <div className="demo-topline"><span>LIVE GAME DEMO</span><span className="demo-status" role="status" aria-live="polite" aria-atomic="true"><i aria-hidden="true" /> {playing ? "ROUND IN PLAY" : time === 0 ? "TIME!" : "READY"}</span></div>
      <div className="category-pills" role="tablist" aria-label="Choose a sample category">
        {categoryNames.map((name, index) => (
          <button key={name} id={`demo-tab-${name.toLowerCase().replaceAll(" ", "-")}`} ref={(node) => { tabRefs.current[index] = node; }} role="tab" aria-selected={category === name} aria-controls="demo-card-panel" tabIndex={category === name ? 0 : -1} className={category === name ? "active" : ""} onClick={() => pickCategory(name)} onKeyDown={(event) => moveCategoryFocus(event, index)}>
            <span>{(() => { const Icon = categoryIcons[name]; return <Icon size={17} weight="fill" />; })()}</span>{name}
          </button>
        ))}
      </div>
      <div className="demo-stage" id="demo-card-panel" role="tabpanel" aria-labelledby={`demo-tab-${category.toLowerCase().replaceAll(" ", "-")}`}>
        <div className="demo-score"><span>TIME</span><strong role="timer" aria-label={`${time} seconds remaining`} className={time <= 8 ? "urgent" : ""}>{String(time).padStart(2, "0")}</strong></div>
        <div className={`demo-card ${card.color} ${flash ?? ""}`}>
          <div className="card-category"><CategoryIcon size={18} weight="fill" />{category}</div>
          <p>MAKE YOUR PEOPLE GUESS</p>
          <h3>{card.word}</h3>
          <div className="no-mention"><span>NO MENTION:</span>{card.forbidden.map((word) => <b key={word}><X size={11} weight="bold" /> {word}</b>)}</div>
        </div>
        <div className="demo-score right"><span>SCORE</span><strong aria-live="polite" aria-atomic="true">{score}</strong></div>
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">Current card: {card.word}. Avoid {card.forbidden.join(", ")}.</span>
      <div className="demo-actions">
        {!playing ? <button className="start-demo" onClick={start}>{time === 0 ? "PLAY AGAIN" : "START 30s ROUND"}<Play size={18} weight="fill" /></button> : <>
          <button className="skip-demo" onClick={() => answer(false)}>SKIP <ArrowDown size={18} weight="bold" /></button>
          <button className="correct-demo" onClick={() => answer(true)}>THEY GOT IT <ArrowUp size={18} weight="bold" /></button>
        </>}
      </div>
      <p className="demo-hint">You give the clues. Your people shout the answer. Just don’t touch the forbidden words.</p>
    </div>
  );
}
