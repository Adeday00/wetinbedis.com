"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { CheckCircle } from "@phosphor-icons/react";

const modes = [
  { id: "room", number: "01", label: "IN PERSON", title: "One phone. Pass it round.", body: "Split into teams. One person holds the phone to their forehead while everyone else gives clues. Get the word before the timer runs out.", bullets: ["2+ players", "Pass one phone", "Reaction videos"], screen: "/app-screens/game-portrait.png" },
  { id: "house", number: "02", label: "HOUSE PARTY", title: "Everybody joins the room.", body: "One person hosts. The rest join with a room code on their own phones. The host runs the game; everybody gets in on the shouting.", bullets: ["Host + join codes", "Play together in person", "Clear player roles"], screen: "/app-screens/house-party.png" },
  { id: "facetime", number: "03", label: "FACETIME", title: "Play while you FaceTime.", body: "Start SharePlay on a compatible FaceTime call. The cards, timer, scores, and turns move along with the conversation.", bullets: ["SharePlay enabled", "Play from anywhere", "Synced turns"], screen: "/app-screens/setup-current.png" },
  { id: "call", number: "04", label: "PLAY ON A CALL", title: "Call each other. Play together.", body: "Open a room, then call on WhatsApp, FaceTime, Discord, or whatever your crew uses. iPhone and Android players can join the same game.", bullets: ["iPhone + Android", "Use your own call app", "Game runs separately"], screen: "/app-screens/game-landscape.png" },
  { id: "solo", number: "05", label: "SOLO GIST", title: "Just you and the cards.", body: "Try Today’s 5, play a quick category, or keep going with Marathon. Your stats stay yours.", bullets: ["Today’s 5", "Quick Play and Marathon", "Personal stats"], screen: "/app-screens/game-portrait.png" },
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
