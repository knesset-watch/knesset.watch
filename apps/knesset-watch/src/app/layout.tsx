import type { Metadata } from "next";
import { Source_Serif_4, Frank_Ruhl_Libre, Heebo } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import AppSidebar from "@/components/AppSidebar";
import { PeriodProvider } from "@/lib/period-context";
import { aiFeaturesEnabled } from "@/lib/feature-flags";

/** תוכן — כותרות, שמות ח"כים, כותרות חוקים */
const frankRuhl = Frank_Ruhl_Libre({
  variable: "--font-frank-ruhl",
  subsets: ["hebrew", "latin"],
});

/** ממשק — כפתורים, תוויות, פקדים, מספרים */
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

/** גיבוי ללטינית בתוך טקסט serif */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "אפרכסת לכנסת",
  description: "שקיפות נתוני הכנסת בזמן אמת",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const aiEnabled = aiFeaturesEnabled();
  return (
    /*
      משתני next/font חייבים לשבת על <html>, לא על <body>.
      @theme מתקמפל ל-:root — שהוא <html> — ולכן var(--font-heebo)
      בתוכו לא נפתר כשהמשתנה מוגדר על <body>, ההגדרה כולה נפסלת,
      וכל האתר נופל לגופן ברירת המחדל של המערכת.
    */
    <html
      lang="he"
      dir="rtl"
      className={`${frankRuhl.variable} ${heebo.variable} ${sourceSerif.variable}`}
    >
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-ui focus:font-medium focus:text-white"
        >
          דלגי לתוכן הראשי
        </a>
        <PeriodProvider>
          <div className="flex min-h-screen" dir="rtl">
            <AppSidebar aiEnabled={aiEnabled} />
            <div className="flex-1 flex flex-col min-w-0">
              <SiteHeader />
              <main id="main" className="flex-1">{children}</main>
            </div>
          </div>
        </PeriodProvider>
      </body>
    </html>
  );
}
