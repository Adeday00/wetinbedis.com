import type { Metadata } from "next";
import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import { CardReviewConsole } from "./card-review-console";

export const metadata: Metadata = {
  title: "Review Party Cards — Wetin Be Dis",
  robots: { index: false, follow: false },
};

export default async function CardReviewPage() {
  const user = await requireChatGPTUser("/card-review");

  return (
    <main className="admin-shell card-review-shell">
      <section className="admin-heading">
        <p className="eyebrow">OWNER CARD REVIEW</p>
        <h1>Review the gist.</h1>
        <p>
          Signed in as <strong>{user.displayName}</strong>. Edit the answer, difficulty, category,
          and all three forbidden words. Your saved draft stays available from this Site.
        </p>
        <a className="admin-signout" href={chatGPTSignOutPath("/")}>Sign out</a>
      </section>
      <CardReviewConsole />
    </main>
  );
}
