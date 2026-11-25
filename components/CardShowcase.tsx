const categories = [
  { id: "slang", name: "Slang" },
  { id: "naija-life", name: "Naija Life" },
  { id: "music", name: "Music" },
  { id: "nollywood", name: "Nollywood" },
  { id: "food", name: "Food" },
  { id: "culture", name: "Culture" },
  { id: "celebrities", name: "Celebrities" },
  { id: "school", name: "School" },
  { id: "religion", name: "Religion" },
  { id: "diaspora", name: "Diaspora" },
  { id: "detty-december", name: "Detty December" },
  { id: "trending-now", name: "Trending Now" },
  { id: "all-gist", name: "All Gist" },
];

export default function CardShowcase() {
  return (
    <section className="card-showcase" aria-labelledby="card-showcase-title">
      <div className="card-showcase-heading">
        <span className="section-kicker">FRESH ART. FAMILIAR CHAOS.</span>
        <h2 id="card-showcase-title">A card for every kind of gist.</h2>
        <p>Pick a deck, put it to your forehead, and let your people do the explaining.</p>
      </div>
      <div className="card-showcase-grid">
        {categories.map((category, index) => (
          <article className="showcase-card" key={category.id}>
            <img
              src={`/category-art/${category.id}.webp`}
              alt={`${category.name} deck illustration`}
              loading={index > 3 ? "lazy" : "eager"}
            />
            <div className="showcase-card-label">
              <span>WETIN BE DIS</span>
              <h3>{category.name}</h3>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
