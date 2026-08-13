import Link from "next/link";
import GameDemo from "@/components/GameDemo";
import ModeExplorer from "@/components/ModeExplorer";
import FAQ from "@/components/FAQ";

const categories = [
  ["ϟ", "Naija Life", "gold"], ["♫", "Music", "teal"], ["✈", "Diaspora", "blue"],
  ["❞", "Slang", "green"], ["♨", "Food", "orange"], ["★", "Celebrities", "purple"],
];

export default function Home() {
  return <main>
    <section className="hero">
      <div className="hero-weave weave-purple" /><div className="hero-weave weave-green" />
      <div className="hero-copy">
        <div className="eyebrow"><i /> THE GIST STARTS HERE <i /></div>
        <h1>You sabi<br /><em>the gist?</em></h1>
        <p>The Nigerian party guessing game that turns your culture, your people, and your inside jokes into pure chaos.</p>
        <div className="hero-actions"><a className="primary-cta" href="#play">TRY A CARD <span>▶</span></a><a className="text-cta" href="#how-it-works">SEE HOW E DEY WORK <span>↓</span></a></div>
        <div className="trust-line"><span>●</span> BUILT FOR REAL ROOMS <b>•</b> FACETIME <b>•</b> HOUSE PARTIES</div>
      </div>
      <div className="hero-visual" aria-label="Wetin Be Dis game cards">
        <div className="hero-glow" />
        {categories.slice(0, 5).map(([icon, name, color], index) => <div className={`hero-card hero-card-${index + 1} ${color}`} key={name}><span className="card-lock">⌑</span><strong>{icon}</strong><b>{name}</b><i>✦</i></div>)}
        <img className="hero-hand" src="/brand/full-gist-hero.png" alt="A hand holding a fan of Wetin Be Dis category cards" />
      </div>
      <div className="scroll-stamp"><span>SCROLL</span><i>↓</i></div>
    </section>

    <section className="marquee" aria-label="Game categories"><div>{[...categories, ...categories].map(([icon, name], i) => <span key={`${name}-${i}`}>{icon} {name}<b>✦</b></span>)}</div></section>

    <section className="how-section" id="how-it-works">
      <div className="section-kicker">NO LONG TING</div><h2>Three steps.<br /><em>Plenty shouting.</em></h2>
      <div className="steps-grid">
        <article><span className="step-number">01</span><div className="step-art card-stack"><i /><i /><i>?</i></div><h3>Pick your gist</h3><p>Choose a category your room thinks they know. Slang? Music? Naija Life? Be brave.</p></article>
        <article><span className="step-number">02</span><div className="step-art clue-art"><strong>JAPA</strong><span>NO MENTION</span><b>VISA</b><b>AIRPORT</b></div><h3>Give the clues</h3><p>Make your person guess the big word—without touching any forbidden words.</p></article>
        <article><span className="step-number">03</span><div className="step-art score-art"><span>00:08</span><strong>7</strong><i>↑</i></div><h3>Settle the score</h3><p>Beat the timer, collect your points, and let the winning crew talk their talk.</p></article>
      </div>
    </section>

    <section className="play-section" id="play">
      <div className="section-heading light"><div><span className="section-kicker">NO DOWNLOAD NEEDED</span><h2>Try the gist<br /><em>right now.</em></h2></div><p>This is one quick taste. The real game brings 350 cards, reaction videos, teams, House Party, and FaceTime.</p></div>
      <GameDemo />
    </section>

    <section className="modes-section" id="modes">
      <div className="section-heading"><div><span className="section-kicker">YOUR PEOPLE. YOUR WAY.</span><h2>Any room can<br /><em>be the room.</em></h2></div><p>From one sofa to three countries, Wetin Be Dis keeps everybody inside the gist.</p></div>
      <ModeExplorer />
    </section>

    <section className="culture-section">
      <div className="culture-grid">
        <div className="culture-image"><img src="/brand/owambe-bg.png" alt="Woven Nigerian textile artwork framing the Wetin Be Dis game" /><span className="culture-sticker">MADE FOR<br /><b>YOUR PEOPLE</b></span></div>
        <div className="culture-copy"><span className="section-kicker">MORE THAN TRIVIA</span><h2>The culture is<br /><em>the gameplay.</em></h2><p>Wetin Be Dis isn’t Nigerian paint on a generic game. The way we gist, argue, act, sing, drag, celebrate, and remember—that is the mechanic.</p><div className="culture-stats"><div><strong>350</strong><span>CARDS AT LAUNCH</span></div><div><strong>10</strong><span>CATEGORIES</span></div><div><strong>∞</strong><span>INSIDE JOKES</span></div></div></div>
      </div>
    </section>

    <section className="full-gist-section" id="full-gist">
      <div className="full-gist-art"><img src="/brand/full-gist-hero.png" alt="Full Gist premium category cards" /><div className="premium-seal">FULL<br />GIST</div></div>
      <div className="full-gist-copy"><span className="section-kicker">ONE PURCHASE. EVERY CORNER.</span><h2>Unlock the<br /><em>whole gist.</em></h2><p>Every category. Every card. Every fresh drop. No ads, no subscription, no “premium monthly pro max.”</p><ul><li><span>✓</span>All 10 categories</li><li><span>✓</span>350 cards and growing</li><li><span>✓</span>No rewarded or post-game ads</li><li><span>✓</span>One-time $9.99 purchase</li></ul><a className="primary-cta" href="#download">SEE FULL GIST <span>↗</span></a><p className="trial-note">Not ready? Free players can watch 3 ads for the Daily Gist.</p></div>
    </section>

    <section className="screens-section">
      <span className="section-kicker">SEE AM FOR YOURSELF</span><h2>Looks like the party.<br /><em>Plays like the party.</em></h2>
      <div className="screen-rail">{[["home.png","WELCOME TO THE GIST"],["setup.png","PICK YOUR CATEGORY"],["play.png","SHOUT THE ANSWER"],["house-party.png","BRING THE WHOLE ROOM"],["full-gist.png","UNLOCK EVERY CORNER"]].map(([file,label],i) => <figure key={file} className={i === 2 ? "featured" : ""}><div className="screenshot-phone"><img src={`/app-screens/${file}`} alt={label.toLowerCase()} /></div><figcaption>{label}</figcaption></figure>)}</div>
    </section>

    <section className="faq-section"><div><span className="section-kicker">ASK BEFORE YOU SHOUT</span><h2>Questions?<br /><em>We get gist.</em></h2><p>Everything your room needs before the first card drops.</p><Link href="/support/" className="text-cta">VISIT SUPPORT <span>↗</span></Link></div><FAQ /></section>

    <section className="download-section" id="download"><div className="download-glow" /><img src="/brand/app-icon.png" alt="Wetin Be Dis app icon" /><span className="section-kicker">THE ROOM IS WAITING</span><h2>Bring your people.<br /><em>We’ll bring the gist.</em></h2><p>Launching on iPhone. Be ready when the first card drops.</p><a className="app-store-badge" href="mailto:adekanbidavid8@gmail.com?subject=Tell%20me%20when%20Wetin%20Be%20Dis%20launches"><span>●</span><small>GET NOTIFIED FOR</small><strong>App Store launch</strong></a><div className="download-domain">WETINBEDIS.COM</div></section>
  </main>;
}
