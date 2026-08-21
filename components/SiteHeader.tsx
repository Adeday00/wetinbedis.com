"use client";

import Link from "next/link";
import { List, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { APP_STORE_URL } from "@/lib/app-store";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Wetin Be Dis home">
      <img src="/brand/app-icon.png" alt="" />
      <span>WETIN<br />BE DIS?</span>
    </Link>
  );
}

export default function SiteHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className={`site-nav ${open ? "menu-open" : ""}`}>
      <Brand />
      <nav id="main-navigation" aria-label="Main navigation">
        <Link href="/#play" onClick={() => setOpen(false)}>Try the game</Link>
        <Link href="/#how-it-works" onClick={() => setOpen(false)}>How e dey work</Link>
        <Link href="/#modes" onClick={() => setOpen(false)}>Ways to play</Link>
        <Link href="/#full-gist" onClick={() => setOpen(false)}>Full Gist</Link>
      </nav>
      <a className="nav-cta" href={APP_STORE_URL}>Download the app</a>
      <button
        className="menu-toggle"
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        aria-controls="main-navigation"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={24} weight="bold" /> : <List size={24} weight="bold" />}
      </button>
    </header>
  );
}
