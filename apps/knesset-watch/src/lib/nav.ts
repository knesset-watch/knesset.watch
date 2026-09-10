/**
 * מקור האמת היחיד לניווט האתר.
 *
 * לפני זה היו שלוש רשימות נפרדות שלא הסכימו ביניהן:
 *   AppSidebar          — דסקטופ, 10 יעדים, מקובצים
 *   SiteHeader          — מובייל, 7 יעדים, בלי קיבוץ
 *   KnessetWatchClient  — מגירה שלישית בתוך /mks בלבד, קיבוץ שלישי
 *
 * התוצאה: /pulse, /track-record, /agendas ו"רשת קשרים" היו נגישים
 * בדסקטופ בלבד. במובייל לא הייתה אליהם שום דרך.
 */

export interface NavLink {
  href: string;
  label: string;
  /** קידומות מסלול שמדליקות את המצב הפעיל */
  prefixes: string[];
}

export interface NavGroup {
  group: string;
  links: NavLink[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: 'אנשים',
    links: [
      { href: '/mks',       label: 'ח"כים', prefixes: ['/mks', '/mk/'] },
      { href: '/ministers', label: 'שרים',   prefixes: ['/ministers', '/office/'] },
    ],
  },
  {
    group: 'עבודת הכנסת',
    links: [
      { href: '/votes',      label: 'הצבעות',     prefixes: ['/votes', '/vote/'] },
      { href: '/bills',      label: 'חוקים',       prefixes: ['/bills', '/bill/'] },
      { href: '/protocols',  label: 'פרוטוקולים',  prefixes: ['/protocols', '/session/'] },
      { href: '/committees', label: 'ועדות',       prefixes: ['/committees', '/committee/', '/faction/'] },
    ],
  },
  {
    group: 'ניתוחים וכלים',
    links: [
      { href: '/pulse',        label: 'חקיקה אחרונה', prefixes: ['/pulse'] },
      { href: '/track-record', label: 'מעקב חקיקה',    prefixes: ['/track-record'] },
      { href: '/agendas',      label: "אג'נדות",       prefixes: ['/agendas', '/agenda/'] },
      // תצוגה של /mks, לא מסלול. היה מצביע ל-'/?groupBy=alliances' — דף הבית מתעלם מהפרמטר,
      // ו-prefixes היה ['/'] שהתאים לכל מסלול וסימן את הפריט כפעיל בכל עמוד.
      { href: '/mks?groupBy=alliances', label: 'רשת קשרים', prefixes: [] },
      { href: '/did-you-know',  label: 'הידעת?',   prefixes: ['/did-you-know'] },
    ],
  },
];

/** נשמר בנפרד — הוא מוצג כפעולה מודגשת, לא כפריט רשימה */
export const AI_LINK: NavLink = {
  href: '/ask',
  label: 'שאל AI',
  prefixes: ['/ask'],
};

/** כל היעדים בשורה אחת — לבדיקות ולמקומות שלא צריכים קיבוץ */
export const ALL_NAV_LINKS: NavLink[] = [
  ...NAV_GROUPS.flatMap(g => g.links),
  AI_LINK,
];

export function isNavActive(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => pathname === p || pathname.startsWith(p));
}
