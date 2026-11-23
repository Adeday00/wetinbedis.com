import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  Play,
  Smiley,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import GameDemo from "@/components/GameDemo";
import ModeExplorer from "@/components/ModeExplorer";
import FAQ from "@/components/FAQ";
import LaunchSignup from "@/components/LaunchSignup";
import TrackedAppStoreLink from "@/components/TrackedAppStoreLink";
import AndroidBetaDialog from "@/components/AndroidBetaDialog";

const proofPoints = [
  { Icon: UsersThree, title: "2,500+", detail: "iPhone players" },
  { Icon: Smiley, title: "120K+", detail: "TikTok + Instagram views" },
  { Icon: Smiley, title: "Made for", detail: "the group chat & living room" },
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <figure className="hero-media">
          <video
            className="hero-footage"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/app-screens/home-current.png"
            aria-label="Friends playing Wetin Be Dis at home"
          >
            <source src="/reactions/pepper-soup-social.mp4" type="video/mp4" />
          </video>
          <figcaption>Actual people. Actual gist.</figcaption>
        </figure>
        <div className="hero-copy">
          <div className="hero-social-proof" aria-label="120,000 combined TikTok and Instagram views; more than 2,500 iPhone users">
            <span><strong>120K+</strong> views across TikTok & IG</span>
            <span className="social-proof-divider" aria-hidden="true" />
            <span><strong>2,500+</strong> iPhone players</span>
          </div>
          <h1><span>WETIN</span><span>BE DIS?</span></h1>
          <h2>The game your group chat<br />will argue over.</h2>
          <p>One person holds the phone. Everybody else starts shouting. Give clues, dodge the no-mention words, and see who really knows the gist.</p>
          <div className="hero-actions">
            <Link className="primary-cta" href="#play">Try a round <Play size={18} weight="fill" /></Link>
            <TrackedAppStoreLink className="secondary-cta">Download on the App Store <ArrowRight size={18} weight="bold" /></TrackedAppStoreLink>
            <AndroidBetaDialog />
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
            <span className="section-kicker">OKAY, YOUR TURN</span>
            <h2>Can your people guess?</h2>
            <p>Get them to the word before time runs out. Just don’t say any of the three things underneath it.</p>
            <Link className="outline-cta" href="#live-demo">Try a round <Play size={17} weight="fill" /></Link>
            <div className="demo-note"><span>Pick a deck. Start the timer. The rest is between you and your people.</span></div>
          </div>
          <div id="live-demo"><GameDemo /></div>
        </div>
      </section>

      <section className="reaction-section" id="reactions">
        <div className="reaction-layout">
          <div className="reaction-video-wrap">
            <video className="reaction-video" autoPlay muted loop playsInline poster="/reactions/pepper-soup-round-poster.jpg" aria-label="Friends playing Wetin Be Dis and reacting to a Pepper Soup card">
              <source src="/reactions/pepper-soup-round.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="reaction-copy">
            <span className="section-kicker">THE CARD SAID PEPPER SOUP</span>
            <h2>Then the room<br />did this.</h2>
            <p>That’s an actual round. Actual friends. Actual noise. Turn on reaction recording in the app and keep the clips your group wants to replay.</p>
            <ul>
              <li>Record the round on your phone</li>
              <li>Your clips stay on your device</li>
              <li>Send the best ones to the group chat</li>
            </ul>
            <TrackedAppStoreLink className="outline-cta">Record your first round <ArrowRight size={17} weight="bold" /></TrackedAppStoreLink>
          </div>
        </div>
      </section>

      <section className="modes-section" id="modes">
        <div className="section-heading">
          <div><span className="section-kicker">HOW YOUR CREW PLAYS</span><h2>Same gist.<br />Different setups.</h2></div>
          <p>Pass one phone around, host a House Party, use SharePlay on FaceTime, or call each other while the game runs on iPhone and Android.</p>
        </div>
        <ModeExplorer />
      </section>

      <section className="big-screen-section" aria-labelledby="big-screen-title">
        <div className="big-screen-art"><img src="/app-screens/game-landscape.png" alt="Wetin Be Dis gameplay in landscape layout for a large display" /></div>
        <div className="big-screen-copy">
          <span className="section-kicker">IN DEVELOPMENT</span>
          <h2 id="big-screen-title">Take the gist<br />to the big screen.</h2>
          <p>The big-screen mode is not available yet. We’re building a way to show the cards and score on a TV or projector while you keep playing from your phone.</p>
          <span className="coming-soon-badge">NOT OUT YET</span>
        </div>
      </section>

      <section className="reviews-section" id="reviews">
        <div className="reviews-heading">
          <span className="section-kicker">Y’ALL SAID IT, NOT US</span>
          <h2>We saw your comments.</h2>
          <p>“When is this coming to Android?” We’ve heard you. Closed beta testing has started, with wider release aimed for around December 14.</p>
        </div>
        <div className="review-grid">
          <figure className="review-card">
            <blockquote>“I need this for game night with my people.”</blockquote>
            <figcaption>THE KIND OF COMMENT THAT STARTED THIS UPDATE</figcaption>
          </figure>
          <figure className="review-card">
            <blockquote>Android people, we see you. The closed beta has started.</blockquote>
            <figcaption>EMAIL OR DM YOUR GOOGLE PLAY GMAIL</figcaption>
          </figure>
        </div>
      </section>

      <section className="founder-section" id="founder">
        <div className="founder-mark" aria-hidden="true">DB</div>
        <div>
          <span className="section-kicker">A NOTE FROM THE PERSON BUILDING IT</span>
          <h2>Wetin be dis?</h2>
          <p>I made the game I wanted at the function: something everybody could jump into, even if they just met. Pass the phone and let the arguments begin. — David</p>
        </div>
      </section>

      <section className="full-gist-section" id="full-gist">
        <div className="full-gist-art"><img src="/brand/full-gist-hero.png" alt="A hand holding Wetin Be Dis category cards" /></div>
        <div className="full-gist-copy">
          <span className="section-kicker">WHEN YOU WANT MORE DECKS</span>
          <h2>Full Gist.</h2>
          <p>Free to download. When you want more, unlock the rest of the party decks and longer Solo rounds with a one-time in-app purchase.</p>
          <ul>
            <li><CheckCircle size={22} weight="fill" />All current party decks</li>
            <li><CheckCircle size={22} weight="fill" />Marathon and longer Solo games</li>
            <li><CheckCircle size={22} weight="fill" />One time purchase. No subscription.</li>
          </ul>
          <p className="price-note">Prices vary by country. Your local App Store price is shown before you buy.</p>
          <TrackedAppStoreLink className="dark-cta">See Full Gist in the App Store <ArrowRight size={18} weight="bold" /></TrackedAppStoreLink>
        </div>
      </section>

      <section className="faq-section">
        <div className="faq-intro"><span className="section-kicker">ASK BEFORE YOU SHOUT</span><h2>Questions?<br />We get gist.</h2><p>Everything your room needs before the first card drops.</p><Link href="/support/" className="text-link">Visit support <ArrowRight size={17} weight="bold" /></Link></div>
        <FAQ />
      </section>

      <section className="download-section" id="download">
        <img src="/brand/app-icon.png" alt="Wetin Be Dis app icon" />
        <span className="section-kicker">2,500+ IPHONE PLAYERS · ANDROID BETA TESTING</span>
        <h2>iPhone is out.<br />Android is in beta.</h2>
        <p>More than 2,500 people are already playing on iPhone. Android beta testing has started; we’re aiming for a wider release around December 14.</p>
        <LaunchSignup />
        <AndroidBetaDialog />
      </section>
    </main>
  );
}
