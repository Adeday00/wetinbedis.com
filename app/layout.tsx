import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
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
          <Link className="brand" href="/" aria-label="Wetin Be Dis home">
            <span className="brand-mark">?</span>
            <span>WETIN<br />BE DIS</span>
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/#how-to-play">How to play</Link>
            <a href="/card-review.html">Review cards</a>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </header>
        {children}
        <footer>
          <Link className="brand small" href="/"><span className="brand-mark">?</span><span>WETIN BE DIS</span></Link>
          <p>© 2026 David Adekanbi. All rights reserved.</p>
          <div><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link></div>
        </footer>
      </body>
    </html>
  );
}
