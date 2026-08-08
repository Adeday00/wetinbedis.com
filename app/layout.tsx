import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  const title = "Wetin Be Dis — The Nigerian Party Guessing Game";
  const description = "Gather your people, pick a category, and prove who really knows the gist.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: `${origin}/og.png`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a className="brand" href="/" aria-label="Wetin Be Dis home">
            <span className="brand-mark">?</span>
            <span>WETIN<br />BE DIS</span>
          </a>
          <nav aria-label="Main navigation">
            <a href="/#how-to-play">How to play</a>
            <a href="/support">Support</a>
            <a href="/privacy">Privacy</a>
          </nav>
        </header>
        {children}
        <footer>
          <a className="brand small" href="/"><span className="brand-mark">?</span><span>WETIN BE DIS</span></a>
          <p>© 2026 David Adekanbi. All rights reserved.</p>
          <div><a href="/support">Support</a><a href="/privacy">Privacy</a></div>
        </footer>
      </body>
    </html>
  );
}
