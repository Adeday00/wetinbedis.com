import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://wetinbedis.com"),
  title: "Wetin Be Dis — The Nigerian Party Guessing Game",
  description: "Bring your people, pick your gist, and prove who really knows Nigerian culture. Play in person, over FaceTime, or at your next house party.",
  openGraph: {
    title: "Wetin Be Dis?",
    description: "Bring your people. Prove you know the gist.",
    url: "https://wetinbedis.com",
    siteName: "Wetin Be Dis",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Wetin Be Dis?",
    description: "Bring your people. Prove you know the gist.",
    images: ["/og.png"],
  },
  icons: { icon: "/brand/app-icon.png", apple: "/brand/app-icon.png" },
};

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Wetin Be Dis home">
      <img src="/brand/app-icon.png" alt="" />
      <span>WETIN<br />BE DIS?</span>
    </Link>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-nav">
          <Brand />
          <nav aria-label="Main navigation">
            <Link href="/#play">Try the game</Link>
            <Link href="/#modes">Ways to play</Link>
            <Link href="/#full-gist">Full Gist</Link>
          </nav>
          <Link className="nav-cta" href="/#download">Get the app <span>↗</span></Link>
        </header>
        {children}
        <footer>
          <div className="footer-brand"><Brand /><p>The Nigerian party game made for your people.</p></div>
          <div className="footer-links"><strong>Explore</strong><Link href="/#play">Try the game</Link><Link href="/#modes">Ways to play</Link><Link href="/#full-gist">Full Gist</Link></div>
          <div className="footer-links"><strong>Company</strong><Link href="/support/">Support</Link><Link href="/privacy/">Privacy</Link><a href="mailto:adekanbidavid8@gmail.com">Contact</a></div>
          <div className="footer-bottom"><span>© 2026 David Adekanbi</span><span>Made with gist, from Naija to everywhere.</span></div>
        </footer>
      </body>
    </html>
  );
}
