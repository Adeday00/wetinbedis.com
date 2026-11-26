import Link from "next/link";
import { ArrowRight, CheckCircle, Play } from "@phosphor-icons/react/dist/ssr";
import GameDemo from "@/components/GameDemo";
import ModeExplorer from "@/components/ModeExplorer";
import FAQ from "@/components/FAQ";
import TrackedAppStoreLink from "@/components/TrackedAppStoreLink";
import AndroidBetaDialog from "@/components/AndroidBetaDialog";
import CardShowcase from "@/components/CardShowcase";

export default function Home() {
  return (
    <main>
      <section className="hero" aria-labelledby="home-title">
        <figure className="hero-media">
          <video
            className="hero-footage"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/app-screens/home-current.png"
            aria-label="Friends playing Wetin Be Dis together"
          >
            <source src="/reactions/dodo-party-gameplay.mp4" type="video/mp4" />
          </video>
          <figcaption>One phone. Everybody shouting.</figcaption>
        </figure>

        <div className="hero-copy">
          <span className="section-kicker">THE NAIJA PARTY GAME</span>
          <h1 id="home-title"><span>WETIN</span><span>BE DIS?</span></h1>
          <h2>Your people know the gist.<br />Can they explain it?</h2>
          <p>Give clues. Dodge the words underneath. Get your people to guess before the timer runs out.</p>
          <div className="hero-actions">
            <TrackedAppStoreLink className="primary-cta">Download on the App Store <ArrowRight size={18} weight="bold" /></TrackedAppStoreLink>
            <Link className="secondary-cta" href="#play">See how it plays <Play size={17} weight="fill" /></Link>
          </div>
          <p className="hero-availability">Free to download · Android beta now open</p>
        </div>
      </section>

      <section className="play-section" id="play" aria-labelledby="play-title">
        <div className="play-layout">
          <div className="play-intro">
            <span className="section-kicker">THAT’S THE WHOLE GAME</span>
            <h2 id="play-title">Explain the word.<br />Don’t say the words.</h2>
            <p>One player gives clues while their team guesses the card. Skip, score, and swap turns. Try a sample round right here.</p>
            <div className="demo-note"><span>Pick a deck and see how fast your people catch on.</span></div>
          </div>
          <div id="live-demo"><GameDemo /></div>
        </div>
        <CardShowcase />
      </section>

      <section className="modes-section" id="modes" aria-labelledby="modes-title">
        <div className="section-heading">
          <div><span className="section-kicker">BRING YOUR PEOPLE</span><h2 id="modes-title">Together in the room<br />or miles apart.</h2></div>
          <p>Pass one phone, host a room, or play while you’re on a call. Pick the setup that fits your people.</p>
        </div>
        <ModeExplorer />
      </section>

      <section className="full-gist-section" id="full-gist" aria-labelledby="full-gist-title">
        <div className="full-gist-art"><img src="/brand/full-gist-hero.png" alt="Wetin Be Dis category cards spread out for game night" loading="lazy" /></div>
        <div className="full-gist-copy">
          <span className="section-kicker">WHEN YOUR CREW WANTS MORE</span>
          <h2 id="full-gist-title">More decks.<br />More ways to play.</h2>
          <p>Start for free. Full Gist is a one-time purchase that opens the party decks, longer Solo rounds, and ad-free gameplay.</p>
          <ul>
            <li><CheckCircle size={21} weight="fill" />Every current party deck</li>
            <li><CheckCircle size={21} weight="fill" />Marathon and category rounds</li>
            <li><CheckCircle size={21} weight="fill" />One payment. No subscription.</li>
          </ul>
          <p className="price-note">Prices vary by country. Your local App Store price is shown before you buy.</p>
          <TrackedAppStoreLink className="dark-cta">See Full Gist in the App Store <ArrowRight size={18} weight="bold" /></TrackedAppStoreLink>
        </div>
      </section>

      <section className="faq-section" aria-labelledby="faq-title">
        <div className="faq-intro"><span className="section-kicker">BEFORE THE FIRST CARD</span><h2 id="faq-title">Quick answers.</h2><p>Need more help? We’ve got you.</p><Link href="/support/" className="text-link">Visit support <ArrowRight size={17} weight="bold" /></Link></div>
        <FAQ compact />
      </section>

      <section className="download-section" id="download" aria-labelledby="download-title">
        <img src="/brand/app-icon.png" alt="" loading="lazy" />
        <span className="section-kicker">GET YOUR PEOPLE TOGETHER</span>
        <h2 id="download-title">Your next game night<br />starts here.</h2>
        <p>Download Wetin Be Dis on iPhone, or join the Android closed beta.</p>
        <div className="download-actions">
          <TrackedAppStoreLink className="launch-cta">Download on the App Store <ArrowRight size={18} weight="bold" /></TrackedAppStoreLink>
          <AndroidBetaDialog />
        </div>
      </section>
    </main>
  );
}
