import type { Metadata } from "next";
import candidates from "../../../content/drafts/2026-W42-to-W46-solo-gist-candidates.json";
import { SoloCandidateBrowser } from "./solo-candidate-browser";

export const metadata: Metadata = { title: "Solo Gist candidates — Wetin Be Dis", robots: { index: false, follow: false } };

export default async function SoloCandidatesPage() {
  return <main className="admin-shell">
    <section className="admin-heading">
      <p className="eyebrow">OWNER REVIEW</p>
      <h1>Solo Gist candidate bank</h1>
      <p>{candidates.cards.length} new cards are ready for editorial review. Access is controlled by the owner dashboard session.</p>
      <a className="admin-signout" href="/admin">Back to owner dashboard</a>
      <a className="admin-review-link" href="/content-admin">Back to content publisher</a>
    </section>
    <SoloCandidateBrowser candidates={candidates.cards} />
  </main>;
}
