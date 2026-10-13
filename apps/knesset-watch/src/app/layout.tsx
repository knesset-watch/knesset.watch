import type { Metadata } from "next";
import { Fredoka, Heebo } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import AppSidebar from "@/components/AppSidebar";
import { SiteHero } from "@/components/SiteHero";
import { PeriodProvider } from "@/lib/period-context";
import { aiFeaturesEnabled } from "@/lib/feature-flags";

/*
  משפחה אחת לכל האתר: Heebo.

  קודם עמדו כאן Rubik לכותרות ו-Assistant לגוף, ולפני כן Frank Ruhl Libre
  ו-Heebo. ההצעה מחזירה את Heebo כפונט יחיד, לפי העיצוב החדש: הוא עוצב
  לעברית מלכתחילה, קריא גם בגדלים הקטנים של הממשק, ומשפחה אחת במקום
  שתיים היא מערכת פשוטה יותר. ההיררכיה עוברת דרך משקל וגודל, כמו קודם.

  נטען במשקלים מפורשים בלבד. בלי זה next/font מושך את כל הטווח הרציף.
*/
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
});

/**
 * פונט תצוגה שני, לתג המוביל בלבד (הציון על הגביע). Fredoka מעוגל
 * ושמן, ותומך גם בעברית, אז גם הכיתוב מתחת לגביע יכול להשתמש בו.
 * משקל אחד, כדי לא למשוך את כל הטווח.
 */
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin", "hebrew"],
  weight: ["600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "אפרכסת לכנסת",
  /*
    התיאור שמופיע בגוגל ובתצוגה המקדימה של קישור בוואטסאפ.
    "בזמן אמת" ירד: הנתונים מתעדכנים בסנכרון לילי, לא בזמן אמת.
  */
  description:
    "אפרכסת לכנסת עוקבת אחרי מה שחברי הכנסת עושים בפועל: איך הצביעו, אילו חוקים יזמו ובאילו ועדות השתתפו. הכול מתוך הנתונים הרשמיים של הכנסת, ובשפה פשוטה.",
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
      className={`${heebo.variable} ${fredoka.variable}`}
    >
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-ui focus:font-medium focus:text-white"
        >
          דלגי לתוכן הראשי
        </a>
        <PeriodProvider>
          {/*
            ההירו (איור, לוגו, חיפוש + AI) יושב בכל עמוד, מעל שורת הסיידבר
            והתוכן ועל כל הרוחב. בטלפון פס התפריט יושב מעליו.
          */}
          <SiteHeader mode="top" />
          <SiteHero aiEnabled={aiEnabled} />
          <div className="flex min-h-screen" dir="rtl">
            <AppSidebar />
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
