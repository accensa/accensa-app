import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Accensa — provable payments for x402 sellers on Stellar";
const description =
  "Agents prove they were charged correctly. Merchants refund without becoming custodians. Receipts anchored on Stellar, verifiable by anyone without an account.";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://accensa-dashboard.vercel.app"),
  openGraph: { title, description, type: "website", siteName: "Accensa" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
