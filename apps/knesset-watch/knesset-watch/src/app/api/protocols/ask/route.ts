import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { searchProtocols, getProtocolSession } from '@/lib/protocols-db';

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
  // 1. Retrieve relevant chunks via FTS5 (2 pages = up to 40 results)
  const [page1, page2] = await Promise.all([
    searchProtocols(question, null, 1),
    searchProtocols(question, null, 2),
  ]);
  const allResults = [...page1.results, ...page2.results];

  if (allResults.length === 0) {
    return NextResponse.json({
      answer: 'לא נמצאו קטעים רלוונטיים לשאלה זו בפרוטוקולי הכנסת.',
      sources: [],
    });
  }

  // 2. Rank sessions by how many matching chunks they have, keep top 5
  const sessionScores = new Map<number, number>();
  for (const r of allResults) {
    sessionScores.set(r.sessionId, (sessionScores.get(r.sessionId) ?? 0) + 1);
  }
  const topSessionIds = [...sessionScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

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

    // Stop adding sessions if we're already at ~8000 chars
    if (context.length > 8000) break;
  }

  // 5. Call Groq (OpenAI-compatible API, free tier)
  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `אתה עוזר חוקר לניתוח פרוטוקולים של ועדות הכנסת הישראלי.
ענה על שאלות בעברית בלבד, בצורה ממוקדת ועובדתית.
הסתמך אך ורק על הקטעים שסופקו. אם המידע הנדרש אינו מצוי בקטעים — אמור זאת בפירוש.
ציין שמות דוברים, תאריכים ושמות ועדות כשרלוונטי.`,
        },
        {
          role: 'user',
          content: `שאלה: ${question}\n\nקטעים מפרוטוקולים:\n${context}`,
        },
      ],
    }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    console.error('Groq error:', err);
    return NextResponse.json({ error: 'שגיאה בשירות ה-AI' }, { status: 502 });
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
