"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle, EnvelopeSimple } from "@phosphor-icons/react";

export default function LaunchSignup() {
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setSubmittedEmail(normalized);
  }

  if (submittedEmail) {
    return (
      <div className="signup-success" role="status" aria-live="polite">
        <CheckCircle size={27} weight="fill" aria-hidden="true" />
        <div><strong>You’re inside.</strong><span>We’ll email {submittedEmail} when the first card drops.</span></div>
      </div>
    );
  }

  return (
    <form className="launch-form" onSubmit={submit}>
      <label htmlFor="launch-email">Email address</label>
      <div className="launch-form-row">
        <div className="email-field">
          <EnvelopeSimple size={20} weight="bold" aria-hidden="true" />
          <input
            id="launch-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <button className="launch-cta" type="submit">Join the launch list <ArrowRight size={19} weight="bold" aria-hidden="true" /></button>
      </div>
      <p className="signup-note">One launch email. No spam. Unsubscribe anytime.</p>
    </form>
  );
}
