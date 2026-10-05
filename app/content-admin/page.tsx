import type { Metadata } from "next";
import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import { ContentAdminConsole } from "./content-admin-console";

export const metadata: Metadata = {
  title: "Content Admin — Wetin Be Dis",
  robots: { index: false, follow: false },
};

export default async function ContentAdminPage() {
  const user = await requireChatGPTUser("/content-admin");

  return (
    <main className="admin-shell">
      <section className="admin-heading">
        <p className="eyebrow">OWNER CONSOLE</p>
        <h1>Weekly content publisher</h1>
        <p>
          Signed in as <strong>{user.displayName}</strong>. Every release is checked before it can
          become the app’s next atomic content drop.
        </p>
        <a className="admin-signout" href={chatGPTSignOutPath("/")}>Sign out</a>
        <a className="admin-review-link" href="/card-review">Open the card review editor</a>
      </section>
      <ContentAdminConsole />
    </main>
  );
}
