import type { Metadata } from "next";
import { Rubik, Assistant } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import AppSidebar from "@/components/AppSidebar";
import { PeriodProvider } from "@/lib/period-context";
import { aiFeaturesEnabled } from "@/lib/feature-flags";

/*
  שתי משפחות, שתיהן מעוצבות לעברית ולא מותאמות אליה בדיעבד.

  קודם עמדו כאן Frank Ruhl Libre ו-Heebo. Frank Ruhl הוא סריף
  קלאסי ויפה, אבל הוא נתן לאתר מראה של ספר ולא של כלי — ובגדלים
  קטנים הסריפים מטשטשים ברנדור של ווינדוס.

  Rubik    כותרות. גיאומטרי, ספירות פתוחות, קריא גם במשקל 700.
  Assistant ממשק וגוף. הומניסטי, נבנה לעברית מלכתחילה, וקריא
            במיוחד ב-12.5 עד 17 פיקסל — הטווח שבו רוב האתר יושב.

  שניהם נטענים במשקלים מפורשים. בלי זה next/font מושך את כל
  הטווח הרציף, וזה 200 קילובייט מיותרים לכל משפחה.
*/
const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["hebrew", "latin"],
  weight: ["500", "600", "700"],
});

const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
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
      @theme מתקמפל ל-:root — שהוא <html> — ולכן var(--font-assistant)
      בתוכו לא נפתר כשהמשתנה מוגדר על <body>, ההגדרה כולה נפסלת,
      וכל האתר נופל לגופן ברירת המחדל של המערכת.
    */
    <html
      lang="he"
      dir="rtl"
      className={`${assistant.variable} ${rubik.variable}`}
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
