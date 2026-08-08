const categories = ["Naija Life", "Music", "Diaspora", "Slang", "Street Life"];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">THE GIST STARTS HERE</div>
        <h1>How well do you<br />really know the gist?</h1>
        <p className="hero-copy">
          The Nigerian party guessing game made for loud rooms, close friends,
          family functions, and FaceTime nights.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href="#how-to-play">See how e dey work</a>
          <a className="button button-secondary" href="/support">Get support</a>
        </div>

        <div className="card-fan" aria-label="Game categories">
          {categories.map((category, index) => (
            <div className={`game-card card-${index + 1}`} key={category}>
              <span>{["ϟ", "♫", "✈", "❞", "▣"][index]}</span>
              <strong>{category}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="paper-strip" id="how-to-play">
        <div>
          <span className="number">01</span>
          <h2>Pick your gist</h2>
          <p>Choose a category your room thinks they know.</p>
        </div>
        <div>
          <span className="number">02</span>
          <h2>Give the clues</h2>
          <p>Help the guesser without saying the answer or forbidden words.</p>
        </div>
        <div>
          <span className="number">03</span>
          <h2>Settle the score</h2>
          <p>Race the timer, win the round, and claim your bragging rights.</p>
        </div>
      </section>

      <section className="modes">
        <div className="section-copy">
          <div className="eyebrow">ONE GAME. YOUR KIND OF ROOM.</div>
          <h2>Play together,<br />wherever your people dey.</h2>
        </div>
        <div className="mode-grid">
          <article><span>☻</span><h3>In person</h3><p>Pass the phone and let the whole room join the chaos.</p></article>
          <article><span>⌁</span><h3>House Party</h3><p>Host or join with a room code so nobody confuses chairman and guest.</p></article>
          <article><span>◉</span><h3>FaceTime</h3><p>Keep the gist moving across compatible SharePlay calls.</p></article>
        </div>
      </section>

      <section className="cta">
        <div className="eyebrow">WETIN BE DIS?</div>
        <h2>Bring the people.<br />We’ll bring the gist.</h2>
        <p>Launching on iPhone.</p>
      </section>
    </main>
  );
}
