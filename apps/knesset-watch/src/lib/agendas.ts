export interface Agenda {
  id: string;
  label: string;
  keywords: string[];
}

export interface Domain {
  id: string;
  label: string;
  description: string;
  keywords: string[];
}

export interface IssueStance {
  id: string;
  label: string;
}

export interface PoliticalIssue {
  id: string;
  domainId: string;
  label: string;
  description: string;
  keywords: string[];
  stances: IssueStance[];
}

export const AGENDAS: Agenda[] = [
  {
    id: "hostages",
    label: "שבויים וחטופים",
    keywords: ["שבויים", "חטופים", "עסקת חטופים", "החטופים"],
  },
  {
    id: "north",
    label: "פינוי צפון",
    keywords: ["פינוי צפון", "נורדים", "תושבי הצפון", "עקורי הצפון"],
  },
  {
    id: "oct7-victims",
    label: "נפגעי 7 באוקטובר",
    keywords: ["נפגעי", "7 באוקטובר", "נובה", "שמיני עצרת"],
  },
  {
    id: "compensation",
    label: "תגמולים ופיצויים",
    keywords: ["תגמול", "פיצויים", "פיצוי", "שיקום", "נפגעי מלחמה"],
  },
  {
    id: "soldiers",
    label: "לוחמים ונופלים",
    keywords: ["לוחמים", "נופלים", "פצועי צבא", 'נכי צה"ל'],
  },
  {
    id: "haredi-draft",
    label: "גיוס חרדים",
    keywords: ["גיוס", "שוויון בנטל", "ישיבות", "חרדים וגיוס"],
  },
  {
    id: "judicial-reform",
    label: "רפורמה משפטית",
    keywords: [
      "רפורמה משפטית",
      "בית משפט עליון",
      "ועדת מינויים",
      "עילת סבירות",
      "עצמאות שיפוטית",
    ],
  },
  {
    id: "gaza",
    label: "מלחמת עזה",
    keywords: ["עזה", "רפח", "מבצע צבאי", "כוח צבאי"],
  },
  {
    id: "budget",
    label: "תקציב המדינה",
    keywords: ["תקציב המדינה", "גירעון", "הוצאות המדינה"],
  },
  {
    id: "women",
    label: "מעמד האישה",
    keywords: ["שוויון מגדרי", "מעמד האישה", "אלימות נגד נשים"],
  },
  {
    id: "arab-citizens",
    label: "ערביי ישראל",
    keywords: ["שוויון לערבים", "המגזר הערבי", "ערביי ישראל"],
  },
  {
    id: "economy",
    label: "כלכלה וצמיחה",
    keywords: ["יוקר המחיה", "שוק הדיור", "אבטלה", "שכר מינימום"],
  },
];

export const DOMAINS: Domain[] = [
  {
    id: "security",
    label: "ביטחון וצבא",
    description:
      "צה״ל, ביטחון לאומי, מלחמה, מילואים, שירות צבאי, טרור ומדיניות ביטחונית.",
    keywords: [
      "ביטחון",
      'צה"ל',
      "צבא",
      "מלחמה",
      "טרור",
      "מילואים",
      "שירות ביטחון",
      "חיילים",
    ],
  },
  {
    id: "economy",
    label: "כלכלה, תקציב ויוקר המחיה",
    description:
      "תקציב המדינה, מיסוי, רגולציה כלכלית, מחירים, עסקים, שכר, תחרות ודיור.",
    keywords: [
      "תקציב",
      "כלכלה",
      "מס",
      "מיסוי",
      "יוקר המחיה",
      "מחירים",
      "עסקים",
      "שכר",
      "דיור",
      "תחרות",
    ],
  },
  {
    id: "health-welfare",
    label: "בריאות ורווחה",
    description:
      "מערכת הבריאות, זכויות חולים, תרופות, בריאות הנפש, קצבאות ושירותי רווחה.",
    keywords: [
      "בריאות",
      "רפואה",
      "חולה",
      "חולים",
      "תרופות",
      "בריאות הנפש",
      "רווחה",
      "קצבאות",
      "ביטוח לאומי",
    ],
  },
  {
    id: "law-government",
    label: "משפט, ממשל ודמוקרטיה",
    description:
      "מערכת המשפט, חקיקה, רשויות השלטון, בחירות, ממשלה, כנסת ורשויות מקומיות.",
    keywords: [
      "משפט",
      "בית משפט",
      "חקיקה",
      "ממשלה",
      "כנסת",
      "בחירות",
      "רשות מקומית",
      "מועצה מקומית",
      "עונשין",
    ],
  },
  {
    id: "rights",
    label: "זכויות ושוויון",
    description:
      "זכויות אדם, שוויון, נגישות, פרטיות, חירויות אזרחיות ואיסור אפליה.",
    keywords: [
      "זכויות",
      "שוויון",
      "אפליה",
      "נגישות",
      "פרטיות",
      "חופש הביטוי",
      "חירות",
    ],
  },
  {
    id: "religion-state",
    label: "דת ומדינה",
    description: "שבת, רבנות, גיור, כשרות, נישואין, שירותי דת ויחסי דת ומדינה.",
    keywords: [
      "שבת",
      "רבנות",
      "גיור",
      "כשרות",
      "נישואין",
      "דת ומדינה",
      "שירותי דת",
    ],
  },
  {
    id: "education",
    label: "חינוך והשכלה",
    description:
      "מערכת החינוך, בתי ספר, מורים, השכלה גבוהה, סטודנטים ותכני לימוד.",
    keywords: [
      "חינוך",
      "בית ספר",
      "בתי ספר",
      "מורים",
      "סטודנטים",
      "אוניברסיטה",
      "השכלה גבוהה",
    ],
  },
  {
    id: "labor",
    label: "עבודה ותעסוקה",
    description: "שכר, זכויות עובדים, פנסיה, אבטלה, תעסוקה ויחסי עובד-מעסיק.",
    keywords: [
      "עבודה",
      "עובדים",
      "שכר",
      "שכר מינימום",
      "פנסיה",
      "אבטלה",
      "תעסוקה",
    ],
  },
  {
    id: "transport-infrastructure",
    label: "תחבורה, דיור ותשתיות",
    description:
      "תחבורה ציבורית, כבישים, רכבות, מקרקעין, תכנון ובנייה ותשתיות.",
    keywords: [
      "תחבורה",
      "כבישים",
      "רכבת",
      "מקרקעין",
      "תכנון ובנייה",
      "דיור",
      "חניה",
      "תשתיות",
    ],
  },
  {
    id: "environment",
    label: "סביבה ואקלים",
    description: "הגנת הסביבה, זיהום, אקלים, פסולת, אנרגיה ושטחים פתוחים.",
    keywords: ["סביבה", "אקלים", "זיהום", "פסולת", "מחזור", "אנרגיה"],
  },
  {
    id: "technology-media",
    label: "טכנולוגיה, תקשורת וחדשנות",
    description:
      "תקשורת, שידורים, פרטיות דיגיטלית, סייבר, טכנולוגיה, פטנטים וחדשנות.",
    keywords: [
      "תקשורת",
      "שידורים",
      "סייבר",
      "טכנולוגיה",
      "פטנטים",
      "דיגיטלי",
      "חדשנות",
    ],
  },
  {
    id: "family-children",
    label: "משפחה וילדים",
    description:
      "זכויות ילדים, משפחה, ירושה, אפוטרופסות, הגנה על קטינים ומעמד המשפחה.",
    keywords: ["ילדים", "קטינים", "משפחה", "ירושה", "אפוטרופוס", "אפוטרופסות"],
  },
];

export const POLITICAL_ISSUES: PoliticalIssue[] = [
  {
    id: "haredi-draft",
    domainId: "security",
    label: "גיוס חרדים",
    description:
      "הרחבת חובת השירות הצבאי על חרדים מול שמירה או הרחבה של פטורים משירות.",
    keywords: [
      "גיוס חרדים",
      "תלמידי ישיבות",
      "פטור מגיוס",
      "שוויון בנטל",
      "שירות ביטחון",
    ],
    stances: [
      {
        id: "support-draft",
        label: "בעד הרחבת חובת הגיוס וצמצום פטורים",
      },
      {
        id: "oppose-draft",
        label: "נגד הרחבת חובת הגיוס ובעד שמירה או הרחבה של פטורים",
      },
    ],
  },
  {
    id: "public-transport-shabbat",
    domainId: "religion-state",
    label: "תחבורה ציבורית בשבת",
    description:
      "הפעלת תחבורה ציבורית בשבת מול שמירה על איסור או צמצום פעילות תחבורה בשבת.",
    keywords: ["תחבורה ציבורית בשבת", "תחבורה בשבת", "אוטובוסים בשבת"],
    stances: [
      {
        id: "support",
        label: "בעד תחבורה ציבורית בשבת",
      },
      {
        id: "oppose",
        label: "נגד תחבורה ציבורית בשבת",
      },
    ],
  },
  {
    id: "judicial-reform",
    domainId: "law-government",
    label: "הרפורמה המשפטית",
    description: "שינוי יחסי הכוחות בין מערכת המשפט לבין הממשלה והכנסת.",
    keywords: [
      "רפורמה משפטית",
      "עילת הסבירות",
      "בג״ץ",
      "בחירת שופטים",
      "ביקורת שיפוטית",
    ],
    stances: [
      {
        id: "support-reform",
        label: "בעד צמצום כוח מערכת המשפט והרחבת כוח הדרג הנבחר",
      },
      {
        id: "oppose-reform",
        label: "נגד צמצום כוח מערכת המשפט ובעד שמירה על עצמאותה",
      },
    ],
  },
  {
    id: "hostage-deal",
    domainId: "security",
    label: "עסקה להשבת חטופים",
    description:
      "קידום עסקה להשבת חטופים מול העדפת המשך לחץ צבאי או התנגדות לעסקה בתנאים מסוימים.",
    keywords: ["עסקת חטופים", "השבת החטופים", "שחרור חטופים", "חטופים"],
    stances: [
      {
        id: "support-deal",
        label: "בעד קידום עסקה להשבת החטופים",
      },
      {
        id: "oppose-deal",
        label: "נגד עסקה בתנאים המוצעים או בעד העדפת לחץ צבאי",
      },
    ],
  },
  {
    id: "gaza-war",
    domainId: "security",
    label: "המשך הלחימה בעזה",
    description:
      "המשך או הרחבת הלחימה והלחץ הצבאי מול צמצום הלחימה או קידום הפסקת אש.",
    keywords: ["עזה", "רפח", "חמאס", "הפסקת אש", "לחימה בעזה"],
    stances: [
      {
        id: "support-military-pressure",
        label: "בעד המשך או הרחבת הלחץ הצבאי",
      },
      {
        id: "support-ceasefire",
        label: "בעד צמצום הלחימה או קידום הפסקת אש",
      },
    ],
  },
  {
    id: "religion-liberalization",
    domainId: "religion-state",
    label: "צמצום כפייה דתית",
    description:
      "הרחבת חופש הבחירה האישי בנושאי דת ומדינה מול שמירת המעמד הדתי הקיים.",
    keywords: [
      "כפייה דתית",
      "חופש דת",
      "חופש מדת",
      "רבנות",
      "נישואין אזרחיים",
      "גיור",
    ],
    stances: [
      {
        id: "support-liberalization",
        label: "בעד צמצום כפייה דתית והרחבת חופש הבחירה",
      },
      {
        id: "support-status-quo",
        label: "בעד שמירה או הרחבה של המעמד הדתי הקיים",
      },
    ],
  },
  {
    id: "women-equality",
    domainId: "rights",
    label: "שוויון וזכויות נשים",
    description:
      "הרחבת זכויות, ייצוג והגנה לנשים מול התנגדות להרחבת מדיניות ייעודית בתחום.",
    keywords: [
      "מעמד האישה",
      "זכויות נשים",
      "שוויון מגדרי",
      "אלימות נגד נשים",
      "ייצוג נשים",
    ],
    stances: [
      {
        id: "support-equality",
        label: "בעד הרחבת שוויון וזכויות נשים",
      },
      {
        id: "oppose-expansion",
        label: "נגד הרחבת מדיניות או זכויות ייעודיות בתחום",
      },
    ],
  },
  {
    id: "arab-equality",
    domainId: "rights",
    label: "שוויון ותקצוב לחברה הערבית",
    description:
      "הרחבת שוויון, תקצוב ופיתוח לחברה הערבית מול התנגדות למדיניות ייעודית.",
    keywords: ["החברה הערבית", "ערביי ישראל", "המגזר הערבי", "יישובים ערביים"],
    stances: [
      {
        id: "support-equality",
        label: "בעד הרחבת שוויון, תקצוב ופיתוח",
      },
      {
        id: "oppose-expansion",
        label: "נגד הרחבת תקצוב או צעדי שוויון ייעודיים",
      },
    ],
  },
  {
    id: "worker-rights",
    domainId: "labor",
    label: "זכויות עובדים",
    description:
      "הרחבת הגנות וזכויות לעובדים מול הרחבת גמישות למעסיקים וצמצום רגולציה.",
    keywords: [
      "זכויות עובדים",
      "שכר מינימום",
      "פנסיה",
      "תנאי עבודה",
      "מעסיקים",
    ],
    stances: [
      {
        id: "support-worker-protection",
        label: "בעד הרחבת זכויות והגנות לעובדים",
      },
      {
        id: "support-employer-flexibility",
        label: "בעד יותר גמישות למעסיקים ופחות רגולציה",
      },
    ],
  },
  {
    id: "economic-intervention",
    domainId: "economy",
    label: "התערבות ממשלתית בכלכלה",
    description:
      "רגולציה והתערבות ממשלתית רחבה יותר מול שוק חופשי וצמצום רגולציה.",
    keywords: [
      "רגולציה",
      "פיקוח מחירים",
      "תחרות",
      "שוק חופשי",
      "התערבות ממשלתית",
    ],
    stances: [
      {
        id: "support-intervention",
        label: "בעד התערבות ורגולציה ממשלתית רחבה יותר",
      },
      {
        id: "support-market",
        label: "בעד פחות רגולציה והתערבות ממשלתית",
      },
    ],
  },
  {
    id: "welfare-expansion",
    domainId: "health-welfare",
    label: "הרחבת שירותי רווחה ובריאות",
    description:
      "הרחבת שירותים וזכויות ציבוריות מול צמצום הוצאה או הרחבות בתחום.",
    keywords: ["קצבאות", "שירותי בריאות", "זכויות חולה", "רווחה", "סל הבריאות"],
    stances: [
      {
        id: "support-expansion",
        label: "בעד הרחבת השירותים והזכויות הציבוריות",
      },
      {
        id: "oppose-expansion",
        label: "נגד הרחבת השירותים או ההוצאה הציבורית",
      },
    ],
  },
  {
    id: "environment-regulation",
    domainId: "environment",
    label: "רגולציה סביבתית",
    description: "הרחבת הגנות ורגולציה סביבתית מול צמצום רגולציה בתחום.",
    keywords: ["רגולציה סביבתית", "זיהום", "פליטות", "אקלים", "הגנת הסביבה"],
    stances: [
      {
        id: "support-regulation",
        label: "בעד הרחבת רגולציה והגנה סביבתית",
      },
      {
        id: "oppose-regulation",
        label: "נגד הרחבת רגולציה סביבתית",
      },
    ],
  },
];

export function getAgenda(id: string): Agenda | undefined {
  return AGENDAS.find((agenda) => agenda.id === id);
}

export function getDomain(id: string): Domain | undefined {
  return DOMAINS.find((domain) => domain.id === id);
}

export function getPoliticalIssue(id: string): PoliticalIssue | undefined {
  return POLITICAL_ISSUES.find((issue) => issue.id === id);
}

export function getIssueStance(
  issueId: string,
  stanceId: string,
): IssueStance | undefined {
  return getPoliticalIssue(issueId)?.stances.find(
    (stance) => stance.id === stanceId,
  );
}
