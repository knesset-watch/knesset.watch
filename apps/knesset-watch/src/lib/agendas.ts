export interface Agenda {
  id: string;
  label: string;
  keywords: string[];
}

export const AGENDAS: Agenda[] = [
  {
    id: 'hostages',
    label: 'שבויים וחטופים',
    keywords: ['שבויים', 'חטופים', 'עסקת חטופים', 'החטופים'],
  },
  {
    id: 'north',
    label: 'פינוי צפון',
    keywords: ['פינוי צפון', 'נורדים', 'תושבי הצפון', 'עקורי הצפון'],
  },
  {
    id: 'oct7-victims',
    label: 'נפגעי 7 באוקטובר',
    keywords: ['נפגעי', '7 באוקטובר', 'נובה', 'שמיני עצרת'],
  },
  {
    id: 'compensation',
    label: 'תגמולים ופיצויים',
    keywords: ['תגמול', 'פיצויים', 'פיצוי', 'שיקום', 'נפגעי מלחמה'],
  },
  {
    id: 'soldiers',
    label: 'לוחמים ונופלים',
    keywords: ['לוחמים', 'נופלים', 'פצועי צבא', 'נכי צה"ל'],
  },
  {
    id: 'haredi-draft',
    label: 'גיוס חרדים',
    keywords: ['גיוס', 'שוויון בנטל', 'ישיבות', 'חרדים וגיוס'],
  },
  {
    id: 'judicial-reform',
    label: 'רפורמה משפטית',
    keywords: ['רפורמה משפטית', 'בית משפט עליון', 'ועדת מינויים', 'עילת סבירות', 'עצמאות שיפוטית'],
  },
  {
    id: 'gaza',
    label: 'מלחמת עזה',
    keywords: ['עזה', 'רפח', 'מבצע צבאי', 'כוח צבאי'],
  },
  {
    id: 'budget',
    label: 'תקציב המדינה',
    keywords: ['תקציב המדינה', 'גירעון', 'הוצאות המדינה'],
  },
  {
    id: 'women',
    label: 'מעמד האישה',
    keywords: ['שוויון מגדרי', 'מעמד האישה', 'אלימות נגד נשים'],
  },
  {
    id: 'arab-citizens',
    label: 'ערביי ישראל',
    keywords: ['שוויון לערבים', 'המגזר הערבי', 'ערביי ישראל'],
  },
  {
    id: 'economy',
    label: 'כלכלה וצמיחה',
    keywords: ['יוקר המחיה', 'שוק הדיור', 'אבטלה', 'שכר מינימום'],
  },
];

export function getAgenda(id: string): Agenda | undefined {
  return AGENDAS.find(a => a.id === id);
}
