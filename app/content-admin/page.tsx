import type { Metadata } from "next";
import { BrandingManager, CategoryManager, ContentAdminConsole, HomeAnnouncementManager, OwnerCardPreviewAdminPanel } from "./content-admin-console";
import { RehearsalPayoutQueue } from "./rehearsal-payout-queue";

export const metadata: Metadata = {
  title: "Content Admin — Wetin Be Dis",
  robots: { index: false, follow: false },
};

export default async function ContentAdminPage() {
  return (
    <main className="admin-shell">
      <section className="admin-heading">
        <p className="eyebrow">OWNER CONSOLE</p>
        <h1>Weekly content publisher</h1>
        <p>
          Use the owner dashboard session to validate and publish atomic releases. Every release is
          checked before it can become the app’s next content drop.
        </p>
        <a className="admin-signout" href="/admin">Back to owner dashboard</a>
        <a className="admin-review-link" href="/card-review">Open the card review editor</a>
        <a className="admin-review-link" href="/content-admin/solo-candidates">Review Solo Gist candidate bank</a>
      </section>
      <ContentAdminConsole />
      <BrandingManager />
      <HomeAnnouncementManager />
      <CategoryManager />
      <OwnerCardPreviewAdminPanel />
      <RehearsalPayoutQueue />
    </main>
  );
}
