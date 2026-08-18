"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { CheckCircle } from "@phosphor-icons/react";

const modes = [
  { id: "room", number: "01", label: "IN PERSON", title: "One phone. Whole room. Maximum noise.", body: "Pass the phone, split into crews, and race the timer together. Perfect for game nights, family visits, weddings, and anywhere your people gather.", bullets: ["2+ players", "Pass one phone", "Reaction videos"], screen: "/app-screens/play.png" },
  { id: "house", number: "02", label: "HOUSE PARTY", title: "Everybody joins. One clear chairman.", body: "The host creates a room code, guests join from their own phones, and everyone always knows who controls the game. Built for the same room without the confusion.", bullets: ["Host + join codes", "Synced game state", "Clear player roles"], screen: "/app-screens/house-party.png" },
  { id: "facetime", number: "03", label: "FACETIME", title: "Distance no fit stop the gist.", body: "Start SharePlay during a compatible FaceTime call and keep the card, timer, scores, and turns moving across everyone’s devices.", bullets: ["SharePlay enabled", "Play from anywhere", "Synced turns"], screen: "/app-screens/setup.png" },
];

export default function ModeExplorer() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mode = modes[active];

  function moveModeFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % modes.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + modes.length) % modes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = modes.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="mode-explorer">
      <div className="mode-tabs" role="tablist" aria-label="Ways to play">
        {modes.map((item, index) => <button key={item.id} id={`mode-tab-${item.id}`} ref={(node) => { tabRefs.current[index] = node; }} role="tab" aria-selected={active === index} aria-controls="mode-panel" tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(event) => moveModeFocus(event, index)} className={active === index ? "active" : ""}><span>{item.number}</span>{item.label}</button>)}
      </div>
      <div className="mode-panel" id="mode-panel" role="tabpanel" aria-labelledby={`mode-tab-${mode.id}`}>
        <div className="mode-copy"><span className="mini-label">{mode.label}</span><h3>{mode.title}</h3><p>{mode.body}</p><ul>{mode.bullets.map((item) => <li key={item}><CheckCircle size={18} weight="fill" />{item}</li>)}</ul></div>
        <div className="mode-visual"><img src={mode.screen} alt={`${mode.label} screen in Wetin Be Dis`} /></div>
      </div>
    </div>
  );
}
