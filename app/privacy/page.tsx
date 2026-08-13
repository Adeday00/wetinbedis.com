import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy — Wetin Be Dis", description: "How Wetin Be Dis handles analytics, advertising, purchases, multiplayer, and reaction recordings." };

export default function Privacy() {
  return <main className="legal-shell"><section className="legal-hero"><span className="section-kicker">YOUR GIST STAYS YOUR GIST</span><h1>Privacy Policy</h1><p>Effective August 5, 2026</p></section><article className="legal-card policy">
    <h2>Overview</h2><p>Wetin Be Dis is a party guessing game created by David Adekanbi. This policy explains what information may be processed when you use the app and the choices available to you.</p>
    <h2>Information the app processes</h2><p>Wetin Be Dis does not require an account. The app may process gameplay and app-usage events, basic device and app information, advertising information handled by Google Mobile Ads, and purchase status supplied through Apple.</p>
    <h2>Reaction recordings</h2><p>If you enable reaction recording, the app requests camera and microphone access. Reaction clips are created for your game experience and stored locally on your device. Wetin Be Dis does not publicly post or upload them. You decide whether to keep or delete clips.</p>
    <h2>House Party and SharePlay</h2><p>Multiplayer features share the information needed to coordinate the active room—such as player names, roles, game state, scores, and room codes—between participating devices. It is not used to create a public profile.</p>
    <h2>How information is used</h2><ul><li>Operate gameplay, multiplayer, purchases, and advertising.</li><li>Understand which modes and categories are useful.</li><li>Diagnose crashes, connection problems, and failed flows.</li><li>Measure advertising performance and prevent fraud.</li><li>Meet legal and platform requirements.</li></ul>
    <h2>Advertising and consent</h2><p>The free experience may show advertisements delivered by Google Mobile Ads. Where required, the app asks for consent before requesting personalized advertising. Your choices, age, region, and device settings may affect the ads you receive.</p>
    <h2>Analytics</h2><p>Wetin Be Dis uses TelemetryDeck for privacy-conscious product analytics. We use aggregated signals to improve the game. We do not sell your personal information or use analytics to create public profiles.</p>
    <h2>Purchases</h2><p>Apple processes in-app purchases. Wetin Be Dis receives the purchase status needed to unlock and restore Full Gist, but does not receive your complete payment-card details.</p>
    <h2>Third-party services</h2><p>The app uses <a href="https://policies.google.com/privacy">Google</a>, <a href="https://www.apple.com/legal/privacy/">Apple</a>, and <a href="https://telemetrydeck.com/privacy/">TelemetryDeck</a>. Information they handle is also subject to their policies.</p>
    <h2>Data retention and your choices</h2><p>Locally stored preferences and reaction clips remain until you remove them or uninstall the app. You can manage camera, microphone, tracking, and notification permissions in iPhone Settings.</p>
    <h2>Children</h2><p>Wetin Be Dis is not intended to knowingly collect personal information from children below the minimum age required in their country without appropriate consent.</p>
    <h2>Changes</h2><p>We may update this policy as the app changes. The effective date above will be revised when material updates are published.</p>
    <div className="contact-box"><span>PRIVACY QUESTIONS?</span><h2>Your question is welcome.</h2><a href="mailto:adekanbidavid8@gmail.com?subject=Wetin%20Be%20Dis%20Privacy">EMAIL US ↗</a></div>
  </article></main>;
}
