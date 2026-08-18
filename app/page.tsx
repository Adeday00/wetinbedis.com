import Link from "next/link";
import {
  ArrowBendRightDown,
  ArrowRight,
  CheckCircle,
  GlobeHemisphereWest,
  Play,
  Smiley,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import GameDemo from "@/components/GameDemo";
import ModeExplorer from "@/components/ModeExplorer";
import FAQ from "@/components/FAQ";
import LaunchSignup from "@/components/LaunchSignup";

const proofPoints = [
  { Icon: UsersThree, title: "One phone.", detail: "Whole room." },
  { Icon: GlobeHemisphereWest, title: "Across three", detail: "countries." },
  { Icon: Smiley, title: "Everybody", detail: "inside the gist." },
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <picture>
          <source media="(max-width: 760px)" srcSet="/brand/generated/game-night-forehead-hero-v1.png" />
          <img
            className="hero-photo"
            src="/brand/generated/game-night-forehead-hero-v1.png"
            alt="A player holds the Wetin Be Dis game to her forehead while friends laugh and shout clues"
          />
        </picture>
        <div className="hero-copy">
          <h1><span>WETIN</span><span>BE DIS?</span></h1>
          <h2>Your people already<br />know the gist.</h2>
          <p>The Nigerian party guessing game for real rooms, FaceTime, and house parties.</p>
          <div className="hero-actions">
            <Link className="primary-cta" href="#play">Try a round <Play size={18} weight="fill" /></Link>
            <Link className="secondary-cta" href="#download">Join the launch list <ArrowRight size={18} weight="bold" /></Link>
          </div>
        </div>
      </section>

      <section className="proof-strip" id="how-it-works" aria-label="Ways Wetin Be Dis brings people together">
        {proofPoints.map(({ Icon, title, detail }) => (
          <div className="proof-point" key={title}>
            <Icon size={44} weight="regular" aria-hidden="true" />
            <p><strong>{title}</strong><span>{detail}</span></p>
          </div>
        ))}
      </section>

      <section className="play-section" id="play">
        <div className="play-layout">
          <div className="play-intro">
            <span className="section-kicker">NO LONG TALK</span>
            <h2>Try the game.</h2>
            <p>Pick a category, see the word, and give the gist without touching the no-mention words. Your people shout. You keep score.</p>
            <Link className="outline-cta" href="#live-demo">Try a round <Play size={17} weight="fill" /></Link>
            <div className="demo-note"><ArrowBendRightDown size={34} weight="light" /> <span>Free. No sign-up.<br />Just vibes.</span></div>
          </div>
          <div id="live-demo"><GameDemo /></div>
        </div>
      </section>

      <section className="modes-section" id="modes">
        <div className="section-heading">
          <div><span className="section-kicker">YOUR PEOPLE. YOUR WAY.</span><h2>Any room can<br />be the room.</h2></div>
          <p>From one sofa to three countries, everyone stays inside the gist.</p>
        </div>
        <ModeExplorer />
      </section>

      <section className="full-gist-section" id="full-gist">
        <div className="full-gist-art"><img src="/brand/full-gist-hero.png" alt="A hand holding Wetin Be Dis category cards" /></div>
        <div className="full-gist-copy">
          <span className="section-kicker">ONE PURCHASE. EVERY CORNER.</span>
          <h2>Full Gist.</h2>
          <p>Every category. Every card. Every fresh drop. No subscription and no ads after you unlock.</p>
          <ul>
            <li><CheckCircle size={22} weight="fill" />All 10 categories</li>
            <li><CheckCircle size={22} weight="fill" />350 cards and growing</li>
            <li><CheckCircle size={22} weight="fill" />One-time $9.99 purchase</li>
          </ul>
          <Link className="dark-cta" href="#download">Get launch access <ArrowRight size={18} weight="bold" /></Link>
        </div>
      </section>

      <section className="faq-section">
        <div className="faq-intro"><span className="section-kicker">ASK BEFORE YOU SHOUT</span><h2>Questions?<br />We get gist.</h2><p>Everything your room needs before the first card drops.</p><Link href="/support/" className="text-link">Visit support <ArrowRight size={17} weight="bold" /></Link></div>
        <FAQ />
      </section>

      <section className="download-section" id="download">
        <img src="/brand/app-icon.png" alt="Wetin Be Dis app icon" />
        <span className="section-kicker">THE ROOM IS WAITING</span>
        <h2>Bring your people.<br />We’ll bring the gist.</h2>
        <p>Launching on iPhone. Join the list and we’ll tell you when the first card drops.</p>
        <LaunchSignup />
      </section>
    </main>
  );
}
