import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { embedQueryPublic, searchProtocolsVec, searchProtocols, getProtocolSession, searchMkSpeakerTurns, searchSpeakerTurnsByVector, searchPlenaryMkTurns, searchPlenaryTurnsByVector } from '@/lib/protocols-db';
import type { ProtocolSearchResult, MkSpeakerTurn, MkSpeakerTurnVec, PlenaryMkTurn } from '@/lib/protocols-db';
import {
  findMkInText,
  getMkPerson,
  getMkPositions,
  searchVotesByKeyword,
  searchBillsByKeyword,
  searchQueriesByKeyword,
} from '@/lib/knesset-db';
import { MK_NICKNAMES } from '@/lib/nicknames';

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
  topicKeywords: string[];
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

// Used for general (non-MK) queries
const SYSTEM_PROMPT_GENERAL = `אתה אנליסט נתוני הכנסת הישראלית. ענה בעברית בלבד, בצורה ממוקדת ואנליטית.
נתח את המקורות שסופקו: פרוטוקולים, הצבעות, הצעות חוק ושאילתות פרלמנטריות.
כשנשאלים שאלה אנליטית: הסק מסקנות מבוססות-נתונים ממה שמופיע במקורות.
ציין תאריכים, שמות ועדות, תוצאות הצבעות ושמות ח"כים.
הסתמך אך ורק על המקורות שסופקו. אל תמציא. אם אין מידע מספיק — אמור זאת.
כתוב טקסט רגיל בלבד — ללא markdown, ללא כוכביות, ללא hashtag.
כשמזכירים אירוע, הצבעה, ישיבה או הצ"ח ממקור נתון: הוסף מיד לאחר הציון את תגית המקור המלאה (SESSION:id, VOTE:id, או BILL:id) בסוגריים מרובעים — לדוגמה: "ב-24.1.2025 [SESSION:1234] הוא הציע...". השתמש בתגית שמופיעה בכותרת הקטע הרלוונטי.`;

// Used when both an MK and a topic are detected — journalist briefing format
const SYSTEM_PROMPT_MK_TOPIC = `אתה עוזר מחקר לעיתונאי נתונים פרלמנטרי. תפקידך: לחבר בין נתוני הכנסת לסיפור העיתונאי הרחב.
ענה בעברית בלבד. כתוב בצורה ברורה וממוקדת, כאילו אתה מבריף כתב פרלמנטרי לפני כתבה.

בנה את התשובה לפי הסדר הזה (דלג על קטגוריה אם אין עליה מידע):
1. רקע: מה הנושא ומה ההקשר הציבורי שלו? (משפט-שניים בלבד)
2. עמדת הח"כ: מה עמדתו — האם הוביל, תמך, התנגד?
3. פעולות: מה יזם / הגיש / אמר — ציין תאריכים ספציפיים.
4. הצבעות: כיצד הצביע בהצבעות הרלוונטיות?
5. תוצאה: מה השיג בפועל? חוק שעבר? שינוי מדיניות? פעולה ממשלתית?

הסתמך אך ורק על המקורות שסופקו. אל תמציא. כתוב טקסט רגיל ללא markdown.
כשמזכירים אירוע ממקור: הוסף [SESSION:id], [VOTE:id], [BILL:id] מיד אחרי הציון.`;

async function callGemini(userMessage: string, systemPrompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
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

// Fetches a brief news context summary using Gemini's Google Search grounding.
// Returns empty string on any failure — always non-blocking.
async function fetchNewsContext(topic: string, mkName?: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !topic) return '';
  const searchQuery = mkName ? `${mkName} ${topic}` : topic;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text:
            `חפש ידיעות עדכניות בעברית על: "${searchQuery}". ` +
            `סכם ב-3-4 משפטים בלבד: מה הנושא, מה עמד על הפרק בציבור, ומה ההקשר הרלוונטי. ` +
            `אל תוסיף מידע מדויק שאינך בטוח בו.`,
          }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    if (!res.ok) return '';
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  } catch {
    return '';
  }
}

// ── Topic keyword extraction ─────────────────────────────────────────────────
// Strips question/stop words and MK name to get the meaningful topic for DB search.
const HE_STOP = new Set([
  'מה','מי','איך','כיצד','מדוע','למה','מתי','האם','כמה',
  'עשה','עשתה','עשו','אמר','אמרה','הצביע','הצביעה','הגיש','הגישה',
  'על','של','ל','ב','מ','את','עם','ו','או','אל','כ','מי',
  'למען','בעד','נגד','לגבי','בנושא','בעניין','בכנסת','הכנסת','כנסת',
  'ה','ש','ו',
]);

// Returns top 3 meaningful topic keywords (longest first) and the raw topic phrase.
// The phrase preserves multi-word topics like "יוקר המחיה" for LIKE searches.
function extractTopicKeywords(query: string, mkName?: string): { keywords: string[]; phrase: string } {
  let text = query;
  if (mkName) {
    for (const part of mkName.split(' ')) {
      text = text.replace(new RegExp(part, 'g'), '');
    }
  }
  // Also strip any nickname that appears (so "ביבי" doesn't become a keyword)
  for (const nickname of Object.keys(MK_NICKNAMES)) {
    text = text.replace(new RegExp(nickname, 'g'), '');
  }
  text = text.trim();
  const phrase = text.replace(/\s+/g, ' ').trim();

  const seen = new Set<string>();
  const keywords = text
    .split(/\s+/)
    .map(w => w.replace(/^[הוש]/, ''))   // strip ה/ו/ש prefix
    .filter(w => w.length >= 3 && !HE_STOP.has(w))
    .sort((a, b) => b.length - a.length)
    .filter(w => { if (seen.has(w)) return false; seen.add(w); return true; })
    .slice(0, 3);

  return { keywords, phrase };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q || q.length < 2) return NextResponse.json({ error: 'שאלה קצרה מדי' }, { status: 400 });
  if (q.length > 500)      return NextResponse.json({ error: 'שאלה ארוכה מדי' }, { status: 400 });

  // 1. Check cache
  const cacheKey = `ask:v8:${q}`;
  const cached = await getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    // 2. Embed query and detect MK entity in parallel
    const [embedding, detectedMk] = await Promise.all([
      embedQueryPublic(q),
      Promise.resolve(findMkInText(q)),
    ]);

    const mkId = detectedMk?.mkId;
    // Extract topic keywords + phrase (MK name and nicknames removed)
    const { keywords: topicKeywords, phrase: topicPhrase } = extractTopicKeywords(q, detectedMk?.fullName);
    const searchTerm = topicPhrase || topicKeywords[0] || '';

    // 3. Run all searches in parallel:
    //    - Speaker turns (MK + topic phrase): targeted speech excerpts
    //    - Vector search: semantic session search (always run when embedding available)
    //    - Structured data: votes, bills, queries
    //    - News context: Gemini-grounded summary of recent news (non-blocking)
    const vectorSearchPromise: Promise<ProtocolSearchResult[]> = embedding
      ? searchProtocolsVec(embedding, null, 40).catch((e: unknown) => { console.error('vec search error:', e); return []; })
      : searchProtocols(q, null, 1).then((r: { results: ProtocolSearchResult[] }) => r.results).catch((e: unknown) => { console.error('text search error:', e); return []; });

    const speakerTurnsPromise: Promise<MkSpeakerTurn[]> =
      mkId && embedding
        ? searchSpeakerTurnsByVector(embedding, mkId, 6)
            .then((turns: MkSpeakerTurnVec[]) =>
              turns.length > 0
                ? turns.map(t => ({
                    sessionId: t.sessionId,
                    committeeName: t.committeeName,
                    date: t.date,
                    text: t.text,
                  }))
                // Fall back to keyword search if vector search returns nothing (embeddings not ready yet)
                : searchTerm.length >= 2
                  ? searchMkSpeakerTurns(mkId, searchTerm, 6)
                  : []
            )
            .catch(() =>
              searchTerm.length >= 2
                ? searchMkSpeakerTurns(mkId, searchTerm, 6)
                : Promise.resolve([])
            )
        : mkId && searchTerm.length >= 2
          ? searchMkSpeakerTurns(mkId, searchTerm, 6)
          : Promise.resolve([]);

    const plenaryTurnsPromise: Promise<PlenaryMkTurn[]> =
      mkId && embedding
        ? searchPlenaryTurnsByVector(embedding, detectedMk!.fullName, 4)
            .then(turns =>
              turns.map(t => ({ ...t }))
            )
            .catch(() =>
              mkId && searchTerm.length >= 2
                ? searchPlenaryMkTurns(detectedMk!.fullName, searchTerm, 4)
                : Promise.resolve([])
            )
        : mkId && searchTerm.length >= 2
          ? searchPlenaryMkTurns(detectedMk!.fullName, searchTerm, 4)
          : Promise.resolve([]);

    const newsContextPromise: Promise<string> = topicPhrase.length >= 2
      ? fetchNewsContext(topicPhrase, detectedMk?.fullName).catch(() => '')
      : Promise.resolve('');

    const [speakerTurns, plenaryTurns, vectorResults, votes, bills, queries, newsContext] = await Promise.all([
      speakerTurnsPromise,
      plenaryTurnsPromise,
      vectorSearchPromise,
      Promise.resolve(searchVotesByKeyword(topicKeywords.length > 0 ? topicKeywords : [q], mkId, 15)),
      Promise.resolve(searchBillsByKeyword(topicKeywords.length > 0 ? topicKeywords : [q], mkId, 8)),
      Promise.resolve(searchQueriesByKeyword(topicKeywords.length > 0 ? topicKeywords : [q], mkId, 8)),
      newsContextPromise,
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
        context += `[SESSION:${t.sessionId}] [נאום ${detectedMk!.fullName} | ${t.date} | ${t.committeeName}]\n${t.text}\n\n`;
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
        context += `[SESSION:${session.sessionId}] [פרוטוקול | ${session.date} | ${session.committeeName ?? 'ועדה'}]\n`;
        if (session.title) context += `${session.title}\n`;
        for (const chunk of chunks.slice(0, 40)) {
          if (chunk.speaker) context += `${chunk.speaker}: `;
          context += chunk.text.trim().replace(/\n{3,}/g, '\n') + '\n';
        }
        context += '\n';
        if (context.length > 5000) break;
      }
    }

    if (plenaryTurns.length > 0) {
      context += `\n## דברי ח"כ במליאה\n`;
      for (const t of plenaryTurns) {
        context += `• ${t.date} — ${t.sessionName}\n  ${t.text.slice(0, 400)}\n`;
      }
    }

    if (votes.length > 0) {
      context += '\n[הצבעות]\n';
      for (const v of votes.slice(0, 10)) {
        sources.push({ type: 'vote', voteId: v.voteId, title: v.title, date: v.date, isPassed: v.isPassed });
        const agenda = v.microAgenda ? ` (${v.microAgenda})` : '';
        const mkDir = v.mkVoteResult ? ` — הצביע ${v.mkVoteResult}` : '';
        context += `[VOTE:${v.voteId}] ${v.date} — ${v.title}${agenda} — ${v.isPassed ? 'עבר' : 'לא עבר'}${mkDir}\n`;
      }
    }

    if (bills.length > 0) {
      context += '\n[הצעות חוק]\n';
      for (const b of bills.slice(0, 5)) {
        sources.push({ type: 'bill', billId: b.billId, title: b.title, committeeName: b.committeeName, isPassed: b.isPassed });
        context += `[BILL:${b.billId}] ${b.title}${b.isPassed ? ' (עבר)' : ''}\n`;
      }
    }

    if (queries.length > 0) {
      context += '\n[שאילתות פרלמנטריות]\n';
      for (const qr of queries.slice(0, 5)) {
        sources.push({ type: 'query', queryId: qr.queryId, title: qr.title, submitDate: qr.submitDate, mkName: qr.mkName });
        const bodyExcerpt = qr.body ? `\n  תוכן: ${qr.body.slice(0, 250)}` : '';
        const responseNote = qr.ministryResponse ? `\n  תשובה: ${qr.ministryResponse.slice(0, 150)}` : '';
        context += `• ${qr.submitDate} — ${qr.title}${bodyExcerpt}${responseNote}\n`;
      }
    }

    if (context.trim().length < 50) {
      return NextResponse.json({ answer: 'לא נמצא מידע רלוונטי לשאלה זו בנתוני הכנסת.', sources: [], detectedMk, topicKeywords: [] });
    }

    // 7. Call Gemini — select prompt and inject news context when available
    const systemPrompt = detectedMk ? SYSTEM_PROMPT_MK_TOPIC : SYSTEM_PROMPT_GENERAL;
    const newsSection = newsContext ? `[הקשר עיתונאי]\n${newsContext}\n\n` : '';
    let answer: string;
    try {
      answer = await callGemini(`שאלה: ${q}\n\n${newsSection}[נתוני כנסת]\n${context}`, systemPrompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const userMsg = msg === 'RATE_LIMIT'
        ? 'שירות ה-AI עמוס כרגע, נסה שוב בעוד כמה שניות'
        : `שגיאה בשירות ה-AI: ${msg}`;
      return NextResponse.json({ error: userMsg }, { status: 502 });
    }

    const response: AskResponse = { answer, sources, detectedMk: detectedMk ?? null, topicKeywords };

    // 8. Cache and return
    await setCached(cacheKey, response);
    return NextResponse.json(response);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('ask error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
