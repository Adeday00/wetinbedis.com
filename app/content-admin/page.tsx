import type { Metadata } from "next";
import { BrandingManager, CategoryManager, ContentAdminConsole, HomeAnnouncementManager, OwnerCardPreviewAdminPanel, OwnerContentCatalogPanel } from "./content-admin-console";
import { RehearsalPayoutQueue } from "./rehearsal-payout-queue";
import { PicsPackAdminPanel } from "./pics-pack-admin";

export const metadata: Metadata = {
  title: "Content Admin — Wetin Be Dis",
  robots: { index: false, follow: false },
};

export default async function ContentAdminPage() {
  return (
    <main className="admin-shell">
      <section className="admin-heading">
        <p className="eyebrow">OWNER CONSOLE</p>
        <h1>Content &amp; app controls</h1>
        <p>
          Edit game cards, manage category access, schedule Home pop-ups, and control what players see.
          Content releases are validated before they reach the app.
        </p>
        <a className="admin-signout" href="/admin">Back to owner dashboard</a>
        <a className="admin-review-link" href="/card-review">Open the card review editor</a>
        <a className="admin-review-link" href="/content-admin/solo-candidates">Review Solo Gist candidate bank</a>
      </section>
      <nav className="content-admin-index" aria-label="Jump to an admin control">
        <a href="#weekly-publisher">Weekly content</a>
        <a href="#four-pics">Four Pics levels</a>
        <a href="#branding">Branding &amp; Home</a>
        <a href="#home-announcement">Home pop-up</a>
        <a href="#categories">Categories &amp; access</a>
        <a href="#card-preview">Phone card preview</a>
        <a href="#published-catalog">Active card catalog</a>
        <a href="#rehearsal-queue">League rehearsal</a>
      </nav>
      <div className="admin-tool-anchor" id="weekly-publisher"><ContentAdminConsole /></div>
      <div className="admin-tool-anchor" id="four-pics"><PicsPackAdminPanel /></div>
      <div className="admin-tool-anchor" id="branding"><BrandingManager /></div>
      <div className="admin-tool-anchor" id="home-announcement"><HomeAnnouncementManager /></div>
      <div className="admin-tool-anchor" id="categories"><CategoryManager /></div>
      <div className="admin-tool-anchor" id="card-preview"><OwnerCardPreviewAdminPanel /></div>
      <div className="admin-tool-anchor" id="published-catalog"><OwnerContentCatalogPanel /></div>
      <div className="admin-tool-anchor" id="rehearsal-queue"><RehearsalPayoutQueue /></div>
    </main>
  );
}
