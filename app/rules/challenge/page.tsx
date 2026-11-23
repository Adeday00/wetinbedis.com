import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "#WetinBeDisChallenge Official Rules — Wetin Be Dis",
  description: "Official rules for the Wetin Be Dis Challenge: post a video of your crew playing, tag @playwetinbedis, and you could win $100. Free to enter, no purchase necessary.",
};

export default function ChallengeRules() {
  return <main className="legal-shell">
    <section className="legal-hero">
      <span className="section-kicker">#WETINBEDISCHALLENGE</span>
      <h1>Challenge Rules</h1>
      <p>Official rules · Last updated November 20, 2026 · Entries close December 5, 2026 at 11:59 PM ET</p>
    </section>
    <article className="legal-card policy">
      <p>We dey celebrate the people bringing Wetin Be Dis to their crew! Gather your people, play a round, post the video, and you could win <strong>$100</strong>. Please read these rules before you enter.</p>
      <p><strong>NO PURCHASE NECESSARY TO ENTER OR WIN.</strong> A purchase will not increase your chances of winning.</p>

      <h2>1. Organizer</h2>
      <p>The Wetin Be Dis Challenge (“the Challenge”) is run by Wetin Be Dis (David Adekanbi) (“the Organizer,” “we,” “us”). Questions can be sent to <a href="mailto:support@wetinbedis.com?subject=Wetin%20Be%20Dis%20Challenge">support@wetinbedis.com</a>.</p>

      <h2>2. Entry period</h2>
      <p>The Challenge opens on November 20, 2026 and closes on <strong>December 5, 2026 at 11:59 PM Eastern Time (ET)</strong>. Entries posted after the close will not be counted.</p>

      <h2>3. Who can enter</h2>
      <p>The Challenge is open to individuals who are <strong>18 years or older</strong> and legal residents of the <strong>United States, United Kingdom, Canada or Nigeria</strong>. Void where prohibited or restricted by law. The Organizer and members of the Organizer’s immediate family are not eligible.</p>

      <h2>4. How to enter</h2>
      <ol>
        <li>Play a round of Wetin Be Dis with your friends or family.</li>
        <li>Record the round and post the video publicly on TikTok, Instagram or X.</li>
        <li>Tag <strong>@playwetinbedis</strong> and include the hashtag <strong>#WetinBeDisChallenge</strong> in your post.</li>
      </ol>
      <p>Your post must stay public until the winner is announced. You may post more than one video, but each person can win only one prize.</p>
      <p>Entry is free. Wetin Be Dis is free to download and play on the <a href="https://apps.apple.com/us/app/wetin-be-dis/id6755572248" target="_blank" rel="noopener noreferrer">App Store</a>. Buying Full Gist or anything else does not improve your chances of winning.</p>

      <h2>5. Content rules</h2>
      <p>Your video must be your own original content, and everyone who appears in it must agree to it being posted. Entries must not contain hate speech, nudity, violence, or anything illegal or harmful. The Organizer may disqualify any entry that breaks these rules or the rules of the platform it was posted on.</p>

      <h2>6. Winner selection and announcement</h2>
      <p>One (1) winner will be chosen <strong>at random</strong> from all eligible entries on <strong>December 8, 2026</strong>, and announced on the @playwetinbedis social accounts that day. We will contact the winner by direct message from an official @playwetinbedis account. The winner must reply within 7 days, or the prize may be forfeited and an alternate winner drawn at random. We will never ask for your password or for payment to claim a prize.</p>

      <h2>7. Prize</h2>
      <p>One (1) winner will receive <strong>$100 USD</strong> (or the equivalent in local currency), paid by bank transfer or PayPal within 14 days of the winner being confirmed. The prize cannot be transferred or exchanged for anything else. The winner is responsible for any taxes that apply to the prize.</p>

      <h2>8. Use of your video</h2>
      <p>By entering, you allow Wetin Be Dis and @playwetinbedis to repost and feature your entry video on our social accounts and website, with credit to you.</p>

      <h2>9. Platforms</h2>
      <p>This Challenge is not sponsored, endorsed or administered by, or associated with, TikTok, Instagram, Meta, X or Apple.</p>

      <h2>10. Changes and privacy</h2>
      <p>The Organizer may modify, suspend or cancel the Challenge if circumstances beyond our control affect how it runs fairly. Any changes will be posted on this page. Personal information you share with us (such as your handle and payout details) will only be used to run the Challenge and deliver the prize. See our <Link href="/privacy/">Privacy Policy</Link>.</p>
    </article>
  </main>;
}
