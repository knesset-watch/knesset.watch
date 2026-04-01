import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { searchProtocols, searchProtocolsVec, embedQueryPublic, getProtocolSession } from '@/lib/protocols-db';
import type { ProtocolSearchResult } from '@/lib/protocols-db';

export const dynamic = 'force-dynamic';

interface AskSource {
  sessionId: number;
  committeeName: string | null;
  date: string;
  title: string | null;
}

export async function POST(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const body = await req.json() as { question?: unknown };
  const question = typeof body.question === 'string' ? body.question.trim() : '';

  if (!question || question.length < 2) {
    return NextResponse.json({ error: 'שאלה קצרה מדי' }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: 'שאלה ארוכה מדי' }, { status: 400 });
  }

  try {
    // 1. Embed once, then vector search top 40 sessions in one call
    const embedding = await embedQueryPublic(question);

    let allResults: ProtocolSearchResult[] = [];
    if (embedding) {
      allResults = await searchProtocolsVec(embedding, null, 40);
    } else {
      // No embedding available — fall back to LIKE search
      const page1 = await searchProtocols(question, null, 1);
      allResults = page1.results;
    }

    if (allResults.length === 0) {
      return NextResponse.json({
        answer: 'לא נמצאו קטעים רלוונטיים לשאלה זו בפרוטוקולי הכנסת.',
        sources: [],
      });
    }

    // 2. Rank sessions by vector proximity (already ordered), keep top 5
    const seen = new Set<number>();
    const topSessionIds: number[] = [];
    for (const r of allResults) {
      if (!seen.has(r.sessionId)) {
        seen.add(r.sessionId);
        topSessionIds.push(r.sessionId);
        if (topSessionIds.length === 5) break;
      }
    }

    // 3. Fetch full session content for top sessions (parallel)
    const sessionResults = await Promise.all(
      topSessionIds.map(id => getProtocolSession(id)),
    );

    // 4. Build context string — cap at 30 chunks per session to limit tokens
    let context = '';
    const sources: AskSource[] = [];

    for (const result of sessionResults) {
      if (!result) continue;
      const { session, chunks } = result;

      sources.push({
        sessionId: session.sessionId,
        committeeName: session.committeeName,
        date: session.date,
        title: session.title,
      });

      context += `[${session.date} | ${session.committeeName ?? 'ועדה'}]\n`;
      if (session.title) context += `${session.title}\n`;

      const cappedChunks = chunks.slice(0, 30);
      for (const chunk of cappedChunks) {
        if (chunk.speaker) context += `${chunk.speaker}: `;
        context += chunk.text.trim().replace(/\n{3,}/g, '\n') + '\n';
      }
      context += '\n';

      // Stop adding sessions if we're already at ~4000 chars (keeps token usage under Groq limits)
      if (context.length > 4000) break;
    }

    // Guard: if context is too thin, nothing useful to send to Groq
    if (context.trim().length < 100) {
      return NextResponse.json({
        answer: 'לא נמצא מידע מספיק בפרוטוקולים על נושא זה.',
        sources: [],
      });
    }

    // 5. Call Groq — try 70b first, fall back to 8b-instant on rate-limit
    const SYSTEM_PROMPT = `אתה עוזר חוקר לניתוח פרוטוקולים של ועדות הכנסת הישראלי.
ענה על שאלות בעברית בלבד, בצורה ממוקדת ועובדתית.
הסתמך אך ורק על הקטעים שסופקו. אם המידע הנדרש אינו מצוי בקטעים — אמור זאת בפירוש.
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
          max_tokens: 768,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `שאלה: ${question}\n\nקטעים מפרוטוקולים:\n${context}` },
          ],
        }),
      });
    }

    let groqRes = await callGroq('llama-3.3-70b-versatile');

    // On rate-limit, wait 1s and retry with the faster 8b model (higher token quota)
    if (groqRes.status === 429) {
      await new Promise(r => setTimeout(r, 1000));
      groqRes = await callGroq('llama-3.1-8b-instant');
    }

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', groqRes.status, err);
      const msg = groqRes.status === 429
        ? 'שירות ה-AI עמוס כרגע, נסה שוב בעוד כמה שניות'
        : 'שגיאה בשירות ה-AI';
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const groqData = await groqRes.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const answer = groqData.choices[0]?.message?.content ?? '';

    return NextResponse.json({ answer, sources });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('protocols/ask error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
