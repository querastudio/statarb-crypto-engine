import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "StatArb Crypto Engine",
  description:
    "Cointegration-based statistical arbitrage engine for crypto: adaptive hedge ratios, rigorous backtesting, and risk management.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">📈 StatArb Engine</span>
          <Link href="/">Dashboard</Link>
          <Link href="/pairs">Pairs</Link>
          <Link href="/positions">Positions</Link>
          <Link href="/backtest">Backtest</Link>
          <Link href="/setup">Setup</Link>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>research &amp; education only</span>
        </nav>
        {children}
      </body>
    </html>
  );
}
