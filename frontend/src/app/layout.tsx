import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";

import { AuthProvider } from "@/lib/auth";
import { Header } from "@/components/Header";
import "./globals.css";

const inter = Inter({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-inter",
});

const grotesk = Space_Grotesk({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-grotesk",
});

export const metadata: Metadata = {
  title: "YourFleet — Truck repair, negotiated prices",
  description:
    "Find trusted truck repair shops across the US. Compare verified partner offers, request quotes, and book repairs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${grotesk.variable} min-h-screen flex flex-col`}>
        <AuthProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <footer className="bg-charcoal text-white/70">
            <div className="mx-auto max-w-6xl px-4 py-8">
              <p className="display text-lg font-bold text-white">YourFleet</p>
              <div className="mt-3 flex flex-wrap justify-between gap-x-8 gap-y-2 text-sm">
                <p className="max-w-[70ch]">
                  Truck repair marketplace. Directory data imported from operator-curated
                  sources — verify details with the shop before you drive. Marketplace prices
                  apply only to verified partner offers booked through YourFleet.
                </p>
                <p>Map data © OpenStreetMap contributors</p>
              </div>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
