import { NextResponse } from "next/server";
import { validateApiAuth } from "@/lib/ui/auth-utils";
import { dbAvailable } from "@/lib/knesset-db";
import { computeStatementLeaders, pickDisplayLeaders, summarizeAcrossStatements, type AgendaSelection } from "@/lib/agenda-activity";
import { POLITICAL_ISSUES } from "@/lib/canonical-agendas";
import { getMkProfile, occupationLine, tenureLabel } from "@/lib/mk-profiles";

/**
 * מודל "לכל היגד": לכל היגד שנענה, מי דחף הכי הרבה בכיוון שנבחר.
 * ראו computeStatementLeaders ו-PROPOSAL-STATEMENT-SCORE.md. חי לצד
 * /api/agenda-activity (הממוצע), כדי שאפשר יהיה להשוות.
 */
const MAX_SELECTIONS = 45;

function parseSelections(raw: unknown): { selections: AgendaSelection[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "נדרש מערך selections עם היגד אחד לפחות" };
  if (raw.length > MAX_SELECTIONS) return { error: `עד ${MAX_SELECTIONS} היגדים בבקשה אחת` };
  const selections: AgendaSelection[] = [];
  for (const item of raw) {
    const issueId = (item as { issueId?: unknown })?.issueId;
    const stanceId = (item as { stanceId?: unknown })?.stanceId;
    if (typeof issueId !== "string" || typeof stanceId !== "string") return { error: "כל פריט צריך issueId ו-stanceId" };
    const issue = POLITICAL_ISSUES.find(i => i.id === issueId);
    if (!issue) return { error: `היגד לא מוכר: ${issueId}` };
    if (!issue.stances.some(s => s.id === stanceId)) return { error: `צד לא מוכר: ${stanceId}` };
    selections.push({ issueId, stanceId });
  }
  return { selections };
}

export async function POST(request: Request) {
  const authError = await validateApiAuth("SITE_PASSWORD", "knesset-watch_auth_token");
  if (authError) return authError;
  if (!dbAvailable()) return NextResponse.json({ error: "Database not available" }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "גוף הבקשה אינו JSON תקין" }, { status: 400 });
  }
  const parsed = parseSelections((body as { selections?: unknown })?.selections);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const enrich = <T extends { mkId: number }>(l: T) => {
      const profile = getMkProfile(l.mkId);
      return { ...l, photo: profile?.photo ?? null, occupation: occupationLine(profile), tenure: tenureLabel(profile) };
    };
    /*
      מחשבים עם הרשימה המלאה (כל מי שדחף בכיוון שנבחר), כי הסיכום לאורך
      ההיגדים צריך לדעת גם על מי שמחוץ לעשירייה. לכרטיסים עצמם מצמצמים
      לתצוגה הרגילה: 10 הראשונים ועוד 5 בכל מחנה.
    */
    const full = computeStatementLeaders(parsed.selections, { limit: Infinity });
    const across = summarizeAcrossStatements(full);
    const summary = { ...across, rows: across.rows.map(enrich) };
    const statements = full.map(st => ({ ...st, leaders: pickDisplayLeaders(st.leaders).map(enrich) }));
    return NextResponse.json({ statements, summary, generatedAt: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "שגיאה לא ידועה";
    console.error("Agenda leaders error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
