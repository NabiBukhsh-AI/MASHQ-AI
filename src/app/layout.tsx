import type { Metadata } from "next";
import {
  Atkinson_Hyperlegible_Next,
  Noto_Nastaliq_Urdu,
  Noto_Naskh_Arabic,
} from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/client/i18n/LanguageProvider";

const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
});

const nastaliq = Noto_Nastaliq_Urdu({
  variable: "--font-nastaliq",
  subsets: ["arabic"],
  weight: ["400", "700"],
  display: "swap",
  adjustFontFallback: false,
});

const naskh = Noto_Naskh_Arabic({
  variable: "--font-naskh",
  subsets: ["arabic"],
  weight: ["400", "700"],
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Mashq",
  description: "Adaptive bilingual learning experience engine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${atkinson.variable} ${nastaliq.variable} ${naskh.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[var(--color-paper)] text-[var(--color-ink)]">
        {/* Above every route group, so the login page and the signed in app share one choice. */}
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
