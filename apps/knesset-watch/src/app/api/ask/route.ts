import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { embedQueryPublic, searchProtocolsVec, searchProtocols, getProtocolSession, searchMkSpeakerTurns } from '@/lib/protocols-db';
import type { ProtocolSearchResult, MkSpeakerTurn } from '@/lib/protocols-db';
import {
  findMkInText,
  getMkPerson,
  getMkPositions,
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

interface AskResponse {
  answer: string;
  sources: Source[];
  detectedMk: { mkId: number; fullName: string } | null;
}

// ── KV cache helpers ──────────────────────────────────────────────────────────

const kvEnabled = () => !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
const TTL_ASK = 2 * 60 * 60; // 2 hours

async function getCached(key: string): Promise<AskResponse | null> {
  if (!kvEnabled()) return null;
  try { return await kv.get<AskResponse>(key); } catch { return null; }
}

async function setCached(key: string, value: AskResponse): Promise<void> {
  if (!kvEnabled()) return;
  try { await kv.set(key, value, { ex: TTL_ASK }); } catch { /* best-effort */ }
}

// ── Gemini call ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `אתה אנליסט נתוני הכנסת הישראלית. ענה בעברית בלבד, בצורה ממוקדת ואנליטית.
נתח את המקורות שסופקו: פרוטוקולים, הצבעות, הצעות חוק ושאילתות פרלמנטריות.
כשנשאלים על ח"כ ספציפי: סכם את עמדותיו, מה יזם, כיצד הצביע, ומה השיג בפועל.
כשנשאלים שאלה אנליטית: הסק מסקנות מבוססות-נתונים ממה שמופיע במקורות.
ציין תאריכים, שמות ועדות, תוצאות הצבעות ושמות ח"כים.
הסתמך אך ורק על המקורות שסופקו. אל תמציא. אם אין מידע מספיק — אמור זאת.
כתוב טקסט רגיל בלבד — ללא markdown, ללא כוכביות, ללא hashtag.`;

async function callGemini(userMessage: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('Gemini error:', res.status, err);
    if (res.status === 429) throw new Error('RATE_LIMIT');
    throw new Error(`Gemini ${res.status}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ── Topic keyword extraction ─────────────────────────────────────────────────
// Strips question/stop words and MK name to get a meaningful topic term for DB search.
const HE_STOP = new Set([
  'מה','מי','איך','כיצד','מדוע','למה','מתי','האם','כמה',
  'עשה','עשתה','עשו','אמר','אמרה','הצביע','הצביעה','הגיש','הגישה',
  'על','של','ל','ב','מ','את','עם','ו','או','אל','כ','מי',
  'למען','בעד','נגד','לגבי','בנושא','בעניין','בכנסת','הכנסת','כנסת',
  'ה','ש','ו',
]);

// Returns top 3 meaningful topic keywords, longest first.
function extractTopicKeywords(query: string, mkName?: string): string[] {
  let text = mkName ? query.replace(mkName, '') : query;
  if (mkName) {
    for (const part of mkName.split(' ')) text = text.replace(part, '');
  }
  const seen = new Set<string>();
  return text
    .split(/\s+/)
    .map(w => w.replace(/^[הוש]/, ''))   // strip ה/ו/ש prefix
    .filter(w => w.length >= 3 && !HE_STOP.has(w))
    .sort((a, b) => b.length - a.length)
    .filter(w => { if (seen.has(w)) return false; seen.add(w); return true; })
    .slice(0, 3);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q || q.length < 2) return NextResponse.json({ error: 'שאלה קצרה מדי' }, { status: 400 });
  if (q.length > 500)      return NextResponse.json({ error: 'שאלה ארוכה מדי' }, { status: 400 });

  // 1. Check cache
  const cacheKey = `ask:v2:${q}`;
  const cached = await getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    // 2. Embed query and detect MK entity in parallel
    const [embedding, detectedMk] = await Promise.all([
      embedQueryPublic(q),
      Promise.resolve(findMkInText(q)),
    ]);

    const mkId = detectedMk?.mkId;
    // Extract topic keywords (top 3 meaningful words, MK name removed)
    const topicKeywords = extractTopicKeywords(q, detectedMk?.fullName);
    const primaryKeyword = topicKeywords[0] ?? '';

    // 3. Run all searches in parallel:
    //    - Speaker turns (MK + topic): targeted speech excerpts
    //    - Vector search: semantic session search (always run when embedding available)
    //    - Structured data: votes, bills, queries
    const vectorSearchPromise: Promise<ProtocolSearchResult[]> = embedding
      ? searchProtocolsVec(embedding, null, 40).catch((e: unknown) => { console.error('vec search error:', e); return []; })
      : searchProtocols(q, null, 1).then((r: { results: ProtocolSearchResult[] }) => r.results).catch((e: unknown) => { console.error('text search error:', e); return []; });

    const speakerTurnsPromise: Promise<MkSpeakerTurn[]> = mkId && primaryKeyword.length >= 2
      ? searchMkSpeakerTurns(mkId, primaryKeyword, 6)
      : Promise.resolve([]);

    const [speakerTurns, vectorResults, votes, bills, queries] = await Promise.all([
      speakerTurnsPromise,
      vectorSearchPromise,
      Promise.resolve(searchVotesByKeyword(topicKeywords.length > 0 ? topicKeywords : [q], mkId, 15)),
      Promise.resolve(searchBillsByKeyword(topicKeywords.length > 0 ? topicKeywords : [q], mkId, 8)),
      Promise.resolve(searchQueriesByKeyword(topicKeywords.length > 0 ? topicKeywords : [q], mkId, 8)),
    ]);

    // 4. Build LLM context + collect sources
    let context = '';
    const sources: Source[] = [];

    // MK profile context (faction + current committees)
    if (mkId && detectedMk) {
      const mkInfo = getMkPerson(mkId);
      const positions = getMkPositions(mkId).filter(p => p.isCurrent);
      if (mkInfo) {
        context += `[פרופיל: ${detectedMk.fullName}]\n`;
        if (mkInfo.factionName) context += `סיעה: ${mkInfo.factionName}\n`;
        const committees = positions.map(p => p.committee || p.dutyDesc).filter(Boolean).slice(0, 5);
        if (committees.length > 0) context += `חברות בוועדות: ${committees.join(', ')}\n`;
        context += '\n';
      }
    }

    // Speaker turns: MK speech excerpts about the topic
    // Falls back to vector search sessions when no turns found
    const useSpeakerTurns = speakerTurns.length > 0;
    if (useSpeakerTurns) {
      for (const t of speakerTurns) {
        sources.push({ type: 'session', sessionId: t.sessionId, committeeName: t.committeeName, date: t.date, title: '' });
        context += `[נאום ${detectedMk!.fullName} | ${t.date} | ${t.committeeName}]\n${t.text}\n\n`;
        if (context.length > 5000) break;
      }
    } else {
      // Generic session path: fetch full protocol sessions from vector results
      const seen = new Set<number>();
      const topSessionIds: number[] = [];
      for (const r of vectorResults) {
        if (!seen.has(r.sessionId)) {
          seen.add(r.sessionId);
          topSessionIds.push(r.sessionId);
          if (topSessionIds.length === 5) break;
        }
      }
      const sessionResults = await Promise.all(topSessionIds.map(id => getProtocolSession(id)));
      for (const result of sessionResults) {
        if (!result) continue;
        const { session, chunks } = result;
        sources.push({ type: 'session', sessionId: session.sessionId, committeeName: session.committeeName ?? '', date: session.date, title: session.title ?? '' });
        context += `[פרוטוקול | ${session.date} | ${session.committeeName ?? 'ועדה'}]\n`;
        if (session.title) context += `${session.title}\n`;
        for (const chunk of chunks.slice(0, 40)) {
          if (chunk.speaker) context += `${chunk.speaker}: `;
          context += chunk.text.trim().replace(/\n{3,}/g, '\n') + '\n';
        }
        context += '\n';
        if (context.length > 5000) break;
      }
    }

    if (votes.length > 0) {
      context += '\n[הצבעות]\n';
      for (const v of votes.slice(0, 10)) {
        sources.push({ type: 'vote', voteId: v.voteId, title: v.title, date: v.date, isPassed: v.isPassed });
        const agenda = v.microAgenda ? ` (${v.microAgenda})` : '';
        const mkDir = v.mkVoteResult ? ` — הצביע ${v.mkVoteResult}` : '';
        context += `• ${v.date} — ${v.title}${agenda} — ${v.isPassed ? 'עבר' : 'לא עבר'}${mkDir}\n`;
      }
    }

    if (bills.length > 0) {
      context += '\n[הצעות חוק]\n';
      for (const b of bills.slice(0, 5)) {
        sources.push({ type: 'bill', billId: b.billId, title: b.title, committeeName: b.committeeName, isPassed: b.isPassed });
        context += `• ${b.title}${b.isPassed ? ' (עבר)' : ''}\n`;
      }
    }

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

    // 7. Call Gemini
    let answer: string;
    try {
      answer = await callGemini(`שאלה: ${q}\n\nמקורות:\n${context}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const userMsg = msg === 'RATE_LIMIT'
        ? 'שירות ה-AI עמוס כרגע, נסה שוב בעוד כמה שניות'
        : `שגיאה בשירות ה-AI: ${msg}`;
      return NextResponse.json({ error: userMsg }, { status: 502 });
    }

    const response: AskResponse = { answer, sources, detectedMk: detectedMk ?? null };

    // 8. Cache and return
    await setCached(cacheKey, response);
    return NextResponse.json(response);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('ask error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
