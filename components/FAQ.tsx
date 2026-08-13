"use client";

import { useState } from "react";

const questions = [
  ["Can we play with one phone?", "Yes. In Person mode is built around one phone. Split into teams, pass the phone, and let the room do the rest."],
  ["Does everybody need Full Gist?", "No. In hosted multiplayer, the host’s selected access determines the categories available for that game. Your friends can join the fun without buying the same pack first."],
  ["What is House Party?", "House Party lets one person host and everybody else join using a room code. The game clearly labels the chairman and guests so nobody confuses who controls the session."],
  ["Are reaction videos uploaded?", "No. Reaction clips are created for your game experience and stored locally on your device. You decide whether to keep or delete them."],
  ["Is Full Gist a subscription?", "No. Full Gist is a one-time purchase that unlocks every premium category and removes ads. No monthly bill."],
];

export default function FAQ() {
  const [open, setOpen] = useState(0);
  return <div className="faq-list">{questions.map(([question, answer], index) => <div className={`faq-item ${open === index ? "open" : ""}`} key={question}><button onClick={() => setOpen(open === index ? -1 : index)} aria-expanded={open === index}><span>{question}</span><i>{open === index ? "−" : "+"}</i></button><div className="faq-answer"><p>{answer}</p></div></div>)}</div>;
}
