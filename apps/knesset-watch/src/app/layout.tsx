import type { Metadata } from "next";
import { Source_Serif_4, Frank_Ruhl_Libre } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import { PeriodProvider } from "@/lib/period-context";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

const frankRuhl = Frank_Ruhl_Libre({
  variable: "--font-frank-ruhl",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "knesset.watch",
  description: "שקיפות נתוני הכנסת בזמן אמת",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sourceSerif.variable} ${frankRuhl.variable} font-serif antialiased bg-white`}>
        <PeriodProvider>
          <SiteHeader />
          {children}
        </PeriodProvider>
      </body>
    </html>
  );
}
