import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Weekly League Rules — Wetin Be Dis",
  description: "Draft rules for the Wetin Be Dis five-week Weekly League.",
};

export default function WeeklyLeagueRules() {
  return <main className="legal-shell">
    <section className="legal-hero">
      <span className="section-kicker">WETIN BE DIS WEEKLY LEAGUE</span>
      <h1>Weekly League Rules</h1>
      <p>Last updated October 21, 2026 · Proposed season: November 11–December 16, 2026</p>
    </section>
    <article className="legal-card policy">
      <p><strong>Not active yet.</strong> These are draft rules for review. The cash season will not open until the final rules, eligibility controls, and support process are published.</p>
      <h2>Prize pool</h2>
      <p>The planned season has five weekly rounds and a total prize pool of ₦500,000. Each round has ₦100,000 in prizes: ₦50,000 for first place, ₦30,000 for second place, and ₦20,000 for third place.</p>
      <h2>Who can enter</h2>
      <p>Planned eligibility is free entry for adults aged 18 or older who are physically located in Nigeria. No purchase is required. One verified attempt is allowed per player per weekly round.</p>
      <h2>Scoring and ranking</h2>
      <p>Answers are graded by the competition server. Ranking uses correct answers first, then server-recorded time tie-breakers. Public standings show pseudonymous handles and scores; legal names, phone numbers, and payout details are never displayed.</p>
      <h2>Winner verification and payout</h2>
      <p>Scores remain provisional until the round closes and fair-play review is complete. Confirmed winners will be contacted through the official support process and paid manually through OPay. Never send bank or wallet details in public comments or ordinary social chat.</p>
      <h2>Updates and support</h2>
      <p>Follow the official Wetin Be Dis accounts for round updates, standings, and winner announcements. Questions can be sent to <a href="mailto:support@wetinbedis.com?subject=Weekly%20League%20Rules">support@wetinbedis.com</a>.</p>
    </article>
  </main>;
}
