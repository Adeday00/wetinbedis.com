export const metadata = { title: "Support — Wetin Be Dis", description: "Help with gameplay, purchases, ads, and privacy in Wetin Be Dis." };

export default function Support() {
  return <main className="legal-shell"><section className="legal">
    <div className="eyebrow">WE DEY FOR YOU</div><h1>Support</h1>
    <p className="updated">Need help getting the gist? Start here.</p>
    <div className="legal-card">
      <div className="support-grid">
        <div className="support-tile"><h2>Weekly League</h2><p>Rules, public standings, score challenges, verification, and payout questions.</p></div>
        <div className="support-tile"><h2>Full Gist purchase</h2><p>Help unlocking or restoring your one-time purchase.</p></div>
        <div className="support-tile"><h2>House Party</h2><p>Help hosting or joining a game with a room code.</p></div>
        <div className="support-tile"><h2>Rewarded ads</h2><p>What to do if an ad does not complete or grant progress.</p></div>
        <div className="support-tile"><h2>Reaction videos</h2><p>Camera, microphone, and locally saved recording help.</p></div>
      </div>
      <h2>Frequently asked questions</h2>
      <div className="faq"><h3>How do I restore Full Gist?</h3><p>Open the Full Gist screen and select <strong>Restore Purchase</strong>. Make sure the device is signed into the same Apple Account used for the original purchase.</p></div>
      <div className="faq"><h3>Why didn’t my rewarded ad count?</h3><p>The complete ad must finish successfully before progress is awarded. Check your connection, return to Solo Gist, and try again. You are never charged for watching an ad.</p></div>
      <div className="faq"><h3>Why can’t my friend join my House Party?</h3><p>Confirm that the host created the room, the guest selected Join, and the room code matches exactly. Both devices should have an active connection and the latest app version.</p></div>
      <div className="faq"><h3>Where are reaction videos stored?</h3><p>Reaction clips are kept on the device and shown after the game. Wetin Be Dis does not publicly post them. Camera and microphone access can be changed in iPhone Settings.</p></div>
      <div className="faq"><h3>How do I report an inappropriate ad?</h3><p>Take a screenshot if possible and email us with the approximate time, your country, and a description of the ad. Do not include sensitive personal information.</p></div>
      <div className="faq"><h3>Where are the Weekly League rules?</h3><p>Read the <a href="/rules/weekly-league">Weekly League Rules</a>. The current published round shows its prize pool, schedule, eligibility, and closing time. Do not send bank details in social comments or ordinary chat.</p></div>
      <div className="contact-box"><strong>Still need help?</strong><p>Email <a href="mailto:support@wetinbedis.com?subject=Wetin%20Be%20Dis%20Support">support@wetinbedis.com</a>. Include your device model, iOS version, app version, and a short description of what happened. We aim to reply within two business days.</p></div>
    </div>
  </section></main>;
}
