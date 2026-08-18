"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "@phosphor-icons/react";

const questions = [
  { id: "one-phone", question: "Can we play with one phone?", answer: "Yes. In Person mode is built around one phone. Split into teams, pass the phone, and let the room do the rest." },
  { id: "full-gist", question: "Does everybody need Full Gist?", answer: "No. In hosted multiplayer, the host’s selected access determines the categories available for that game. Your friends can join the fun without buying the same pack first." },
  { id: "house-party", question: "What is House Party?", answer: "House Party lets one person host and everybody else join using a room code. The game clearly labels the chairman and guests so nobody confuses who controls the session." },
  { id: "rewarded-ads", question: "What if a rewarded ad does not finish?", answer: "Check your connection, reopen the app, and try once more. If the reward still does not appear, email support with your device model, iOS version, and app version." },
  { id: "reaction-videos", question: "Are reaction videos uploaded?", answer: "No. Reaction clips are created for your game experience and stored locally on your device. You decide whether to keep or delete them." },
  { id: "subscription", question: "Is Full Gist a subscription?", answer: "No. Full Gist is a one-time purchase that unlocks every premium category and removes ads. No monthly bill." },
];

export default function FAQ() {
  const [open, setOpen] = useState(0);

  useEffect(() => {
    function openId(id: string) {
      const index = questions.findIndex((item) => item.id === id);
      if (index >= 0) setOpen(index);
    }
    function openFromHash() {
      openId(window.location.hash.replace("#faq-", ""));
    }
    function openFromTopicLink(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#faq-"]') : null;
      if (target) openId(target.hash.replace("#faq-", ""));
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    document.addEventListener("click", openFromTopicLink);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      document.removeEventListener("click", openFromTopicLink);
    };
  }, []);

  return <div className="faq-list">{questions.map(({ id, question, answer }, index) => {
    const expanded = open === index;
    const buttonId = `faq-${id}`;
    const panelId = `faq-panel-${id}`;
    return <div className={`faq-item ${expanded ? "open" : ""}`} key={id}>
      <button id={buttonId} onClick={() => setOpen(expanded ? -1 : index)} aria-expanded={expanded} aria-controls={panelId}>
        <span>{question}</span>{expanded ? <Minus size={22} weight="bold" aria-hidden="true" /> : <Plus size={22} weight="bold" aria-hidden="true" />}
      </button>
      <div className="faq-answer" id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded}><p>{answer}</p></div>
    </div>;
  })}</div>;
}
