import type { Metadata } from "next";
import FAQ from "@/components/FAQ";

export const metadata: Metadata = { title: "Support — Wetin Be Dis", description: "Help with gameplay, purchases, ads, House Party, FaceTime, and reaction videos." };

export default function Support() {
  return <main className="legal-shell"><section className="legal-hero"><span className="section-kicker">WE DEY FOR YOU</span><h1>Support</h1><p>Something no clear? Start here.</p></section><section className="legal-card"><div className="support-grid"><div><span>♛</span><h2>Full Gist</h2><p>Unlocking, purchasing, or restoring your one-time purchase.</p></div><div><span>⌁</span><h2>House Party</h2><p>Hosting, joining, room codes, and connection help.</p></div><div><span>▶</span><h2>Rewarded ads</h2><p>What to do if an ad does not complete or grant progress.</p></div><div><span>●</span><h2>Reaction videos</h2><p>Camera, microphone, recording, saving, and deleting clips.</p></div></div><h2 className="faq-title">Frequently asked questions</h2><FAQ /><div className="contact-box"><span>STILL NEED HELP?</span><h2>Tell us wetin happen.</h2><p>Include your device model, iOS version, app version, and a short description. We aim to reply within two business days.</p><a href="mailto:support@wetinbedis.com?subject=Wetin%20Be%20Dis%20Support">EMAIL SUPPORT ↗</a></div></section></main>;
}
