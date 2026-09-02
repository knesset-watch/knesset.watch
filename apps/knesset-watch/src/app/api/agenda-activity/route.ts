import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import { computeAgendaActivity, type AgendaSelection } from '@/lib/agenda-activity';
import { POLITICAL_ISSUES } from '@/lib/agendas';
import { getMkProfile, profileSummary } from '@/lib/mk-profiles';

/** תקרה שמונעת בקשה שתסרוק את כל האג'נדות בבת אחת */
const MAX_SELECTIONS = 10;

/** כמה ח"כים מוחזרים. התצוגה מראה עשרה, השאר לגלילה */
const RESULT_LIMIT = 25;

function parseSelections(raw: unknown): { selections: AgendaSelection[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'נדרש מערך selections עם אג\'נדה אחת לפחות' };
  }
  if (raw.length > MAX_SELECTIONS) {
    return { error: `עד ${MAX_SELECTIONS} אג'נדות בבקשה אחת` };
  }

  const selections: AgendaSelection[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { error: 'כל בחירה צריכה להיות אובייקט עם issueId' };
    }
    const { issueId, stanceId } = item as { issueId?: unknown; stanceId?: unknown };

    if (typeof issueId !== 'string') {
      return { error: 'issueId חסר או אינו מחרוזת' };
    }
    const issue = POLITICAL_ISSUES.find(i => i.id === issueId);
    if (!issue) {
      return { error: `אג'נדה לא מוכרת: ${issueId}` };
    }

    if (stanceId !== undefined) {
      if (typeof stanceId !== 'string' || !issue.stances.some(s => s.id === stanceId)) {
        return { error: `עמדה לא מוכרת באג'נדה ${issueId}: ${String(stanceId)}` };
      }
    }

    selections.push({ issueId, stanceId: typeof stanceId === 'string' ? stanceId : undefined });
  }

  return { selections };
}

export async function POST(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
  }

  const parsed = parseSelections((body as { selections?: unknown })?.selections);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = computeAgendaActivity(parsed.selections);

    // תמונה ושורת רקע מ-Wikidata. חסרים אצל 7 ח"כים — התצוגה נופלת
    // חזרה לראשי תיבות, כפי שהיה קודם.
    const rows = result.rows.slice(0, RESULT_LIMIT).map(row => {
      const profile = getMkProfile(row.mkId);
      return {
        ...row,
        photo: profile?.photo ?? null,
        background: profileSummary(profile),
      };
    });

    return NextResponse.json({
      rows,
      // כמה ח"כים בכלל נכנסו לדירוג, לפני החיתוך
      totalRanked: result.rows.length,
      coverage: result.coverage,
      generatedAt: result.generatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
    console.error('Agenda activity error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
