const categories = [
  { id: "slang", name: "Slang" },
  { id: "music", name: "Music" },
  { id: "culture", name: "Culture" },
  { id: "naija-life", name: "Naija Life" },
  { id: "food", name: "Food" },
];

export default function CardShowcase() {
  return (
    <section className="card-showcase" aria-labelledby="card-showcase-title">
      <div className="card-showcase-heading">
        <span className="section-kicker">PICK YOUR GIST</span>
        <h2 id="card-showcase-title">Find your people in the cards.</h2>
        <p>Slang, music, food, and the moments everybody knows.</p>
      </div>
      <div className="card-showcase-grid">
        {categories.map((category, index) => (
          <article className="showcase-card" key={category.id}>
            <img
              src={`/category-art/${category.id}.webp`}
              alt={`${category.name} deck illustration`}
              loading={index > 1 ? "lazy" : "eager"}
            />
            <div className="showcase-card-label">
              <h3>{category.name}</h3>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
