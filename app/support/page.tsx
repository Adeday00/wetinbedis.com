import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Crown, HouseLine, PlayCircle, VideoCamera } from "@phosphor-icons/react/dist/ssr";
import FAQ from "@/components/FAQ";

export const metadata: Metadata = { title: "Support — Wetin Be Dis", description: "Help with gameplay, purchases, ads, House Party, FaceTime, and reaction videos." };

const topics = [
  { href: "#faq-full-gist", Icon: Crown, title: "Full Gist", body: "Unlocking, purchasing, or restoring your one-time purchase." },
  { href: "#faq-house-party", Icon: HouseLine, title: "House Party", body: "Hosting, joining, room codes, and connection help." },
  { href: "#faq-rewarded-ads", Icon: PlayCircle, title: "Rewarded ads", body: "What to do if an ad does not complete or grant progress." },
  { href: "#faq-reaction-videos", Icon: VideoCamera, title: "Reaction videos", body: "Camera, microphone, recording, saving, and deleting clips." },
];

export default function Support() {
  return <main className="legal-shell">
    <section className="legal-hero">
      <span className="section-kicker">WE DEY FOR YOU</span>
      <h1>Support</h1>
      <p>Something no clear? Choose a topic or check the quick answers below.</p>
    </section>
    <section className="legal-card">
      <nav className="support-grid" aria-label="Support topics">
        {topics.map(({ href, Icon, title, body }) => <Link href={href} key={title}>
          <Icon size={28} weight="fill" aria-hidden="true" />
          <span className="support-card-copy"><strong>{title}</strong><small>{body}</small></span>
          <ArrowRight className="support-card-arrow" size={20} weight="bold" aria-hidden="true" />
        </Link>)}
      </nav>
      <h2 className="faq-title" id="faq">Frequently asked questions</h2>
      <FAQ />
      <div className="contact-box">
        <span>STILL NEED HELP?</span>
        <h2>Tell us wetin happen.</h2>
        <p>Include your device model, iOS version, app version, and a short description. We aim to reply within two business days.</p>
        <a href="mailto:support@wetinbedis.com?subject=Wetin%20Be%20Dis%20Support">Email support <ArrowRight size={18} weight="bold" aria-hidden="true" /></a>
      </div>
    </section>
  </main>;
}
