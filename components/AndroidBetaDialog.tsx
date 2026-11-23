"use client";

import { useRef } from "react";
import { ArrowRight, X } from "@phosphor-icons/react";

export default function AndroidBetaDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="beta-cta" type="button" onClick={() => dialogRef.current?.showModal()}>
        Join the Android beta <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
      <dialog className="beta-dialog" ref={dialogRef} aria-labelledby="beta-dialog-title" onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}>
        <button className="beta-dialog-close" type="button" aria-label="Close Android beta details" onClick={() => dialogRef.current?.close()}>
          <X size={22} weight="bold" />
        </button>
        <span className="section-kicker">ANDROID CLOSED BETA</span>
        <h2 id="beta-dialog-title">Help us test the gist.</h2>
        <p>Android beta testing has started. We’re aiming for a wider release around December 14.</p>
        <p>To join, email us or DM us the <strong>Gmail address linked to your Google Play account</strong>. Please don’t send your password.</p>
        <div className="beta-dialog-actions">
          <a className="beta-dialog-primary" href="mailto:support@wetinbedis.com?subject=Android%20closed%20beta">Email us</a>
          <a className="beta-dialog-secondary" href="https://www.instagram.com/playwetinbedis/" target="_blank" rel="noopener noreferrer">DM on Instagram</a>
        </div>
      </dialog>
    </>
  );
}
