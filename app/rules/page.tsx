import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Rules — Wetin Be Dis",
  description: "Official rules for Wetin Be Dis challenges and competitions, including the #WetinBeDisChallenge.",
};

export default function RulesIndex() {
  return <main className="legal-shell">
    <section className="legal-hero">
      <span className="section-kicker">WETIN BE DIS RULES</span>
      <h1>Rules</h1>
      <p>Official rules for Wetin Be Dis challenges and competitions.</p>
    </section>
    <article className="legal-card policy">
      <h2><Link href="/rules/challenge/">#WetinBeDisChallenge</Link></h2>
      <p>Play a round with your crew, post the video on TikTok, Instagram or X, tag @playwetinbedis and use #WetinBeDisChallenge for a chance to win $100. Free to enter, no purchase necessary. Entries close December 5, 2026 at 11:59 PM ET. <Link href="/rules/challenge/">Read the official Challenge rules</Link>.</p>
      <h2><Link href="/rules/weekly-league/">Weekly League</Link></h2>
      <p>Draft rules for the proposed Weekly League. Not active yet. <Link href="/rules/weekly-league/">Read the Weekly League draft rules</Link>.</p>
    </article>
  </main>;
}
