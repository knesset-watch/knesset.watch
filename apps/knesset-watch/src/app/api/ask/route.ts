import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { embedQueryPublic, searchProtocolsVec, searchProtocols, getProtocolSession } from '@/lib/protocols-db';
import type { ProtocolSearchResult } from '@/lib/protocols-db';
import {
  findMkInText,
  searchVotesByKeyword,
  searchBillsByKeyword,
  searchQueriesByKeyword,
} from '@/lib/knesset-db';

export const dynamic = 'force-dynamic';

type SessionSource = { type: 'session'; sessionId: number; committeeName: string; date: string; title: string };
type VoteSource   = { type: 'vote';    voteId: number;    title: string; date: string; isPassed: boolean };
type BillSource   = { type: 'bill';    billId: number;    title: string; committeeName: string | null; isPassed: boolean };
type QuerySource  = { type: 'query';   queryId: number;   title: string; submitDate: string; mkName: string };
type Source = SessionSource | VoteSource | BillSource | QuerySource;

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q || q.length < 2) return NextResponse.json({ error: 'שאלה קצרה מדי' }, { status: 400 });
  if (q.length > 500)      return NextResponse.json({ error: 'שאלה ארוכה מדי' }, { status: 400 });

  try {
    // 1. Embed query and detect MK entity in parallel
    const [embedding, detectedMk] = await Promise.all([
      embedQueryPublic(q),
      Promise.resolve(findMkInText(q)),
    ]);

    const mkId = detectedMk?.mkId;

    // 2. Run all searches in parallel
    const [protocolResults, votes, bills, queries] = await Promise.all([
      embedding
        ? searchProtocolsVec(embedding, null, 40)
        : searchProtocols(q, null, 1).then((r: { results: ProtocolSearchResult[] }) => r.results),
      Promise.resolve(searchVotesByKeyword(q, mkId, 15)),
      Promise.resolve(searchBillsByKeyword(q, mkId, 8)),
      Promise.resolve(searchQueriesByKeyword(q, mkId, 8)),
    ]);

    // 3. Deduplicate protocol results → top 5 sessions
    const seen = new Set<number>();
    const topSessionIds: number[] = [];
    for (const r of protocolResults) {
      if (!seen.has(r.sessionId)) {
        seen.add(r.sessionId);
        topSessionIds.push(r.sessionId);
        if (topSessionIds.length === 5) break;
      }
    }

    // 4. Fetch full protocol session content in parallel
    const sessionResults = await Promise.all(topSessionIds.map(id => getProtocolSession(id)));

    // 5. Build LLM context + collect sources
    let context = '';
    const sources: Source[] = [];

    // Protocol context (~4000 chars)
    for (const result of sessionResults) {
      if (!result) continue;
      const { session, chunks } = result;
      sources.push({
        type: 'session',
        sessionId: session.sessionId,
        committeeName: session.committeeName ?? '',
        date: session.date,
        title: session.title ?? '',
      });
      context += `[פרוטוקול | ${session.date} | ${session.committeeName ?? 'ועדה'}]\n`;
      if (session.title) context += `${session.title}\n`;
      for (const chunk of chunks.slice(0, 40)) {
        if (chunk.speaker) context += `${chunk.speaker}: `;
        context += chunk.text.trim().replace(/\n{3,}/g, '\n') + '\n';
      }
      context += '\n';
      if (context.length > 4000) break;
    }

    // Vote context (~1200 chars)
    if (votes.length > 0) {
      context += '\n[הצבעות]\n';
      for (const v of votes.slice(0, 10)) {
        sources.push({ type: 'vote', voteId: v.voteId, title: v.title, date: v.date, isPassed: v.isPassed });
        const agenda = v.microAgenda ? ` (${v.microAgenda})` : '';
        context += `• ${v.date} — ${v.title}${agenda} — ${v.isPassed ? 'עבר' : 'לא עבר'}\n`;
      }
    }

    // Bill context (~800 chars)
    if (bills.length > 0) {
      context += '\n[הצעות חוק]\n';
      for (const b of bills.slice(0, 5)) {
        sources.push({ type: 'bill', billId: b.billId, title: b.title, committeeName: b.committeeName, isPassed: b.isPassed });
        context += `• ${b.title}${b.isPassed ? ' (עבר)' : ''}\n`;
      }
    }

    // Query context
    if (queries.length > 0) {
      context += '\n[שאילתות פרלמנטריות]\n';
      for (const qr of queries.slice(0, 5)) {
        sources.push({ type: 'query', queryId: qr.queryId, title: qr.title, submitDate: qr.submitDate, mkName: qr.mkName });
        context += `• ${qr.submitDate} — ${qr.title}\n`;
      }
    }

    if (context.trim().length < 50) {
      return NextResponse.json({ answer: 'לא נמצא מידע רלוונטי לשאלה זו בנתוני הכנסת.', sources: [], detectedMk });
    }

    // 6. Call Groq — try 70b first, fall back to 8b-instant on rate-limit
    const SYSTEM_PROMPT = `אתה עוזר המנתח נתוני הכנסת הישראלית. ענה בעברית בלבד, בצורה ממוקדת ועובדתית.
הסתמך אך ורק על המקורות שסופקו. אם המידע הנדרש אינו מצוי — אמור זאת בפירוש.
ציין שמות דוברים, תאריכים ושמות ועדות כשרלוונטי.`;

    async function callGroq(model: string): Promise<Response> {
      return fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `שאלה: ${q}\n\nמקורות:\n${context}` },
          ],
        }),
      });
    }

    // Use 8b-instant first — 5× higher TPM quota than 70b; fall back to 70b if needed
    let groqRes = await callGroq('llama-3.1-8b-instant');
    if (groqRes.status === 429) {
      await new Promise(r => setTimeout(r, 1000));
      groqRes = await callGroq('llama-3.3-70b-versatile');
    }

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('ask error:', groqRes.status, err);
      const msg = groqRes.status === 429 || groqRes.status === 413
        ? 'שירות ה-AI עמוס כרגע, נסה שוב בעוד כמה שניות'
        : 'שגיאה בשירות ה-AI';
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const groqData = await groqRes.json() as { choices: Array<{ message: { content: string } }> };
    const answer = groqData.choices[0]?.message?.content ?? '';

    return NextResponse.json({ answer, sources, detectedMk: detectedMk ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('ask error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
