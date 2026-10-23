import type { Metadata } from "next";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";

import { AuthProvider } from "@/lib/auth";
import { Header } from "@/components/Header";
import "./globals.css";

const barlow = Barlow({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-barlow",
});

const barlowCond = Barlow_Semi_Condensed({
  weight: ["600", "700"],
  subsets: ["latin"],
  variable: "--font-barlow-cond",
});

export const metadata: Metadata = {
  title: "YourFleet — Truck repair, negotiated prices",
  description:
    "Find trusted truck repair shops across the US. Compare verified partner offers, request quotes, and book repairs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${barlow.variable} ${barlowCond.variable} min-h-screen flex flex-col`}>
        <AuthProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-line bg-panel">
            <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-steel flex flex-wrap gap-x-8 gap-y-2 justify-between">
              <p>YourFleet — truck repair marketplace. Directory data imported from operator-curated sources; verify details with the shop before you drive.</p>
              <p>Map data © OpenStreetMap contributors</p>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
