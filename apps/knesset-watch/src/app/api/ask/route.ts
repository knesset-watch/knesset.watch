import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { validateApiAuth } from "@/lib/ui/auth-utils";
import { aiFeaturesEnabled } from "@/lib/feature-flags";
import { geminiFetch, geminiUrl, DailyQuotaError } from "@/lib/gemini-fetch";
import { checkAskBudget, budgetNotice, BUDGET } from "@/lib/ask-budget";
import {
  embedQueryPublic,
  searchProtocols,
  searchProtocolsVec,
  getProtocolSession,
  searchMkSpeakerTurns,
  searchSpeakerTurnsByVector,
  searchPlenaryMkTurns,
  searchPlenaryTurnsByVector,
  searchVotesByVector,
} from "@/lib/protocols-db";
import type {
  ProtocolSearchResult,
  MkSpeakerTurn,
  MkSpeakerTurnVec,
  PlenaryMkTurn,
  PlenaryMkTurnVec,
} from "@/lib/protocols-db";
import {
  findMkInText,
  getMkPerson,
  getMkPositions,
  searchVotesByKeyword,
  searchBillsByKeyword,
  searchQueriesByKeyword,
  getMkFactionId,
  getVoteFactionContext,
  getVoteMeta,
} from "@/lib/knesset-db";
import { MK_NICKNAMES } from "@/lib/nicknames";
import { rateLimit } from "@/lib/ui/rate-limit";

export const dynamic = "force-dynamic";

/**
 * האם מותר להוציא קריאות עזר ל-Gemini מעבר לתשובה עצמה.
 *
 * המסלול החינמי נותן 20 בקשות ליום לכל הפרויקט. עם ארבע קריאות
 * לשאלה זה חמש שאלות ליום; עם אחת זה עשרים. שכתוב השאילתה, ההקשר
 * החדשותי והצעות ההמשך הם שיפורים — התשובה עומדת בלעדיהם — ולכן
 * הם כבויים עד שמישהו משדרג את המסלול.
 *
 * להדליק: ASK_AUX_CALLS=true בקובץ הסביבה.
 */
const auxCallsEnabled = process.env.ASK_AUX_CALLS === "true";

type SessionSource = {
  type: "session";
  sessionId: number;
  committeeName: string;
  date: string;
  title: string;
  snippet?: string;
};
type VoteSource = {
  type: "vote";
  voteId: number;
  title: string;
  date: string;
  isPassed: boolean;
};
type BillSource = {
  type: "bill";
  billId: number;
  title: string;
  committeeName: string | null;
  isPassed: boolean;
};
type QuerySource = {
  type: "query";
  queryId: number;
  title: string;
  submitDate: string;
  mkName: string;
};
type Source = SessionSource | VoteSource | BillSource | QuerySource;

interface AskResponse {
  answer: string;
  sources: Source[];
  detectedMk: { mkId: number; fullName: string } | null;
  topicKeywords: string[];
}

// ── KV cache ──────────────────────────────────────────────────────────────────

const TTL_ASK = 2 * 60 * 60;
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  )
    return null;
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

async function getCached(key: string): Promise<AskResponse | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<AskResponse>(key);
  } catch {
    return null;
  }
}

async function setCached(key: string, value: AskResponse): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: TTL_ASK });
  } catch {
    /* best-effort */
  }
}

// ── Gemini helpers ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_GENERAL = `אתה אנליסט נתוני הכנסת הישראלית. ענה בעברית בלבד, בצורה ממוקדת ואנליטית.
נתח את המקורות שסופקו: פרוטוקולים, הצבעות, הצעות חוק ושאילתות פרלמנטריות.
כשנשאלים שאלה אנליטית: הסק מסקנות מבוססות-נתונים ממה שמופיע במקורות.
ציין תאריכים, שמות ועדות, תוצאות הצבעות ושמות ח"כים.
הסתמך אך ורק על המקורות שסופקו. אל תמציא. אם אין מידע מספיק — אמור זאת.
כתוב טקסט רגיל בלבד — ללא markdown, ללא כוכביות, ללא hashtag.
כשמזכירים אירוע, הצבעה, ישיבה או הצ"ח ממקור נתון: הוסף מיד לאחר הציון את תגית המקור המלאה (SESSION:id, VOTE:id, או BILL:id) בסוגריים מרובעים — לדוגמה: "ב-24.1.2025 [SESSION:1234] הוא הציע...".
סיים בשורה אחת: "הרשומה מכסה: פרוטוקולי ועדות, הצבעות מליאה, הצעות חוק ושאילתות פרלמנטריות. הצהרות לתקשורת, ראיונות ופגישות ממשלתיות אינם חלק ממאגר זה."`;

const SYSTEM_PROMPT_MK_TOPIC = `אתה עוזר מחקר לעיתונאי נתונים פרלמנטרי. תפקידך: לסכם את הרשומה הרשמית של הכנסת בצורה מקיפה ומדויקת.
ענה בעברית בלבד. כתוב בצורה ברורה וממוקדת, כאילו אתה מבריף כתב פרלמנטרי לפני כתבה.

בנה את התשובה לפי הסדר הזה (דלג על קטגוריה אם אין עליה מידע):
1. רקע: מה הנושא ומי הח"כ — סיעה, עמדת ממשלה/אופוזיציה. (משפט-שניים בלבד)
2. עמדת הח"כ: מה עמדתו בנושא — האם הוביל, תמך, התנגד? האם עמדתו השתנתה לאורך זמן לפי הרשומה?
3. פעולות בכנסת: מה יזם / הגיש / אמר בכנסת — ציין תאריכים ספציפיים.
4. הצבעות: כיצד הצביע — ציין האם היה עם קו מפלגתו או בניגוד לו, ואם ההצבעה עברה או נכשלה.
5. תוצאה: מה השיג בפועל לפי הרשומה? חוק שעבר? שינוי מדיניות?
6. גבולות הרשומה: משפט אחד על מה שאינו מכוסה בנתוני הכנסת.

הסתמך אך ורק על נתוני הכנסת שסופקו. אל תמציא. כתוב טקסט רגיל ללא markdown.
כשמזכירים אירוע ממקור: הוסף [SESSION:id], [VOTE:id], [BILL:id] מיד אחרי הציון.`;

async function* streamGemini(
  userMessage: string,
  systemPrompt: string,
): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  /*
    פתיחת הזרם בטוחה לניסיון חוזר: עוד לא נשלח לדפדפן אף תו, ולכן
    ניסיון שני מתחיל תשובה נקייה ולא ממשיך אחת קטועה.
    התקרה נדיבה יותר מהשאר — כאן נכתבת התשובה המלאה.
  */
  const res = await geminiFetch(
    geminiUrl("streamGenerateContent", key, "&alt=sse"),
    {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    { label: "ask/stream", retries: 3, timeoutMs: 45_000 },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("Gemini error:", res.status, err);
    if (res.status === 429) throw new Error("RATE_LIMIT");
    // 503 ו-429 אחרי הניסיונות פירושם עומס אצל ספק המודל, לא תקלה אצלנו
    if (res.status === 503 || res.status === 504) throw new Error("OVERLOADED");
    throw new Error(`Gemini ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /*
    סיום שאינו STOP פירושו שהמודל נעצר באמצע — תקרת טוקנים, חסימת
    בטיחות או חשד לשחזור מקור מוגן. בלי לעקוב אחריו, זרם שנקטע
    נראה בדיוק כמו זרם שהסתיים כרגיל.
  */
  let finishReason: string | null = null;
  let emitted = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          candidates?: Array<{
            finishReason?: string;
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const candidate = parsed.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        /*
          כל ה-parts, לא רק הראשון: דגמי 3.x מחזירים לעיתים חלק
          ריק עם thoughtSignature לצד חלק שיש בו טקסט.
        */
        for (const part of candidate?.content?.parts ?? []) {
          if (part.text) { emitted += part.text.length; yield part.text; }
        }
      } catch {
        /* skip */
      }
    }
  }

  if (finishReason && finishReason !== "STOP") {
    console.error(`ask: המודל נעצר — ${finishReason} אחרי ${emitted} תווים`);
    throw new Error(`TRUNCATED:${finishReason}`);
  }
  if (emitted === 0) {
    console.error("ask: המודל החזיר זרם ריק");
    throw new Error("EMPTY");
  }
}

// Rewrites the query before embedding: expands nicknames, adds synonyms/official terms.
// Runs in ~200ms and the result is used for the vector embedding.
async function rewriteQueryForSearch(
  query: string,
  mkName?: string,
): Promise<string> {
  if (!auxCallsEnabled) return query;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return query;
  try {
    const res = await geminiFetch(
      geminiUrl("generateContent", key),
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `שאילתת חיפוש בנתוני הכנסת: "${query}"${mkName ? ` (ח"כ: ${mkName})` : ""}\n\n` +
                  `הפק גרסה משופרת לחיפוש סמנטי (שורה אחת, עברית בלבד):\n` +
                  `• הרחב כינויים לשמות מלאים (ביבי → בנימין נתניהו, גנץ → בני גנץ)\n` +
                  `• הוסף מונחים רשמיים/חוקיים אם רלוונטיים\n` +
                  `• הוסף מילה נרדפת אחת לכל היותר לנושא המרכזי\n` +
                  `• שמור על עצם הנושא — אל תוסיף נושאים חדשים`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 60,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      /*
        אפס ניסיונות חוזרים, במכוון. השכתוב הוא שיפור לאיכות החיפוש
        ולא תנאי לו — אם הוא נכשל נוסעים עם השאלה המקורית. הוא גם
        חוסם: שום חיפוש לא מתחיל לפני שהוא חוזר. ניסיון שני היה מוסיף
        שניות לכל שאלה כדי להציל שיפור שממילא אינו הכרחי.
      */
      { label: "ask/rewrite", retries: 0, timeoutMs: 3_500 },
    );
    if (!res.ok) return query;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rewritten =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    return rewritten.length > 3 ? rewritten : query;
  } catch {
    return query;
  }
}

async function generateSuggestions(query: string): Promise<string[]> {
  if (!auxCallsEnabled) return [];
  const key = process.env.GEMINI_API_KEY;
  if (!key) return [];
  try {
    const res = await geminiFetch(
      geminiUrl("generateContent", key),
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `בהתבסס על השאלה הבאה על הכנסת: "${query}"\n` +
                  `הצע 3 שאלות המשך קצרות ושימושיות בעברית שהמשתמש עשוי לשאול.\n` +
                  `כל שאלה שורה אחת, ללא מספרים, ללא סימנים.`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 160,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      { label: "ask/suggest", retries: 1, timeoutMs: 8_000 },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 5)
      .slice(0, 3);
  } catch {
    return [];
  }
}

async function fetchNewsContext(
  topic: string,
  mkName?: string,
): Promise<string> {
  if (!auxCallsEnabled) return "";
  const key = process.env.GEMINI_API_KEY;
  if (!key || !topic) return "";
  const searchQuery = mkName ? `${mkName} ${topic}` : topic;
  try {
    const res = await geminiFetch(
      geminiUrl("generateContent", key),
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `חפש ידיעות עדכניות בעברית על: "${searchQuery}". ` +
                  `סכם ב-3-4 משפטים בלבד: מה הנושא, מה עמד על הפרק בציבור, ומה ההקשר הרלוונטי. ` +
                  `אל תוסיף מידע מדויק שאינך בטוח בו.`,
              },
            ],
          },
        ],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          maxOutputTokens: 300,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      { label: "ask/news", retries: 0, timeoutMs: 3_500 },
    );
    if (!res.ok) return "";
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  } catch {
    return "";
  }
}

// ── Temporal expression parser ────────────────────────────────────────────────

interface DateRange {
  dateFrom?: string;
  dateTo?: string;
}

function parseDateRange(query: string): DateRange {
  const now = new Date();
  const y = now.getFullYear();
  const today = now.toISOString().slice(0, 10);

  if (/לאחרונ[הו]?|אחרונות?/.test(query)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return { dateFrom: d.toISOString().slice(0, 10), dateTo: today };
  }
  if (/\bהחודש\b/.test(query)) {
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return { dateFrom: `${y}-${m}-01`, dateTo: today };
  }
  if (/\bהשנה\b/.test(query)) {
    return { dateFrom: `${y}-01-01`, dateTo: today };
  }
  if (/אשתקד|שנה שעברה/.test(query)) {
    return { dateFrom: `${y - 1}-01-01`, dateTo: `${y - 1}-12-31` };
  }
  // "בשנת 2023" / "שנת 2023" / bare "2023"
  const yearMatch = query.match(/(?:בשנת|שנת)?\s*(20[12]\d)\b/);
  if (yearMatch) {
    const yr = yearMatch[1];
    return { dateFrom: `${yr}-01-01`, dateTo: `${yr}-12-31` };
  }
  return {};
}

// ── Hebrew morphological stemmer ─────────────────────────────────────────────

function stemHebrew(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ים") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("ות") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("ה") && word.length > 4) return word.slice(0, -1);
  return word;
}

// ── Topic keyword extraction ─────────────────────────────────────────────────

const HE_STOP = new Set([
  "מה",
  "מי",
  "איך",
  "כיצד",
  "מדוע",
  "למה",
  "מתי",
  "האם",
  "כמה",
  "עשה",
  "עשתה",
  "עשו",
  "אמר",
  "אמרה",
  "הצביע",
  "הצביעה",
  "הגיש",
  "הגישה",
  "על",
  "של",
  "ל",
  "ב",
  "מ",
  "את",
  "עם",
  "ו",
  "או",
  "אל",
  "כ",
  "למען",
  "בעד",
  "נגד",
  "לגבי",
  "בנושא",
  "בעניין",
  "בכנסת",
  "הכנסת",
  "כנסת",
  "ה",
  "ש",
  "ו",
  "למעט",
  "פרט",
  "חוץ",
  "מלבד",
  "נוסף",
  "גם",
  "רק",
  "אך",
  "אלא",
  "ביחס",
]);

function extractTopicKeywords(
  query: string,
  mkName?: string,
): { keywords: string[]; stemmedKeywords: string[]; phrase: string } {
  let text = query;
  if (mkName) {
    for (const part of mkName.split(" "))
      text = text.replace(new RegExp(part, "g"), "");
  }
  for (const nickname of Object.keys(MK_NICKNAMES))
    text = text.replace(new RegExp(nickname, "g"), "");
  text = text.trim();
  const phrase = text.replace(/\s+/g, " ").trim();

  const seen = new Set<string>();
  const keywords = text
    .split(/\s+/)
    .map((w) =>
      w
        .replace(/^[הוש]/, "")
        .replace(/[^א-ת\d]+$/, "")
        .replace(/^[^א-ת\d]+/, ""),
    )
    .filter((w) => w.length >= 3 && !HE_STOP.has(w))
    .sort((a, b) => b.length - a.length)
    .filter((w) => {
      if (seen.has(w)) return false;
      seen.add(w);
      return true;
    })
    .slice(0, 5);

  return { keywords, stemmedKeywords: keywords.map(stemHebrew), phrase };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth(
    "SITE_PASSWORD",
    "knesset-watch_auth_token",
  );
  if (authError) return authError;

  if (!aiFeaturesEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  /*
    עשר שאלות בדקה אינן התנהגות אנושית — הקלדה, קריאת תשובה של
    עשר שניות, וחשיבה על השאלה הבאה. חמש מספיקות בשפע ומקשות על
    סקריפט שמנסה לרוקן את המכסה.
  */
  const { isLimited } = rateLimit(req, {
    limit: BUDGET.perIpPerMinute,
    windowMs: 60_000,
  });

  if (isLimited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429 },
    );
  }
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length < 2)
    return NextResponse.json({ error: "שאלה קצרה מדי" }, { status: 400 });
  if (q.length > 500)
    return NextResponse.json({ error: "שאלה ארוכה מדי" }, { status: 400 });

  // Multi-turn: optional previous question + answer for conversation context
  const prevQ = req.nextUrl.searchParams.get("prev_q")?.trim() ?? "";
  const prevA = req.nextUrl.searchParams.get("prev_a")?.trim() ?? "";
  const hasPrevContext = prevQ.length > 0 && prevA.length > 0;

  // 1. Check cache (only for single-turn — multi-turn context is ephemeral)
  /*
    v11 משתי סיבות: להשליך את התשובות הקטועות שנשמרו לפני התיקון,
    ולא לערבב תשובות של הדגם הקודם עם החדש. המספר עולה בכל שינוי
    שמייתר את מה שכבר שמור.
  */
  const cacheKey = `ask:v11:${q}`;
  if (!hasPrevContext) {
    const cached = await getCached(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  /*
    שלוש תקרות: חודשית גלובלית, יומית גלובלית, ויומית לכל כתובת.
    הגלובליות הן ההגנה האמיתית — כתובת IP ניתנת להחלפה, ולכן מגבלה
    שנשענת רק עליה אינה מגנה על ההוצאה.
  */
  const budget = await checkAskBudget(req);

  if (!budget.allowed) {
    const notice = budgetNotice(budget.reason);
    return NextResponse.json(
      // kind מאפשר לממשק להציג הודעה ולא אזהרה אדומה
      { error: notice.message, kind: notice.kind },
      {
        status: budget.reason === "unavailable" ? 503 : 429,
        headers: { "Retry-After": "3600" },
      },
    );
  }

  try {
    // 2. Detect MK + parse temporal range from query in parallel
    const [detectedMk, dateRange] = await Promise.all([
      Promise.resolve(findMkInText(q)),
      Promise.resolve(parseDateRange(q)),
    ]);

    const mkId = detectedMk?.mkId;
    const {
      keywords: topicKeywords,
      stemmedKeywords,
      phrase: topicPhrase,
    } = extractTopicKeywords(q, detectedMk?.fullName);
    const stemmedTerm =
      stemmedKeywords[0] || topicPhrase || topicKeywords[0] || "";

    // 3. Rewrite query for better semantic retrieval, then embed.
    //    Runs sequentially (rewrite → embed) but each call is fast.
    const queryForEmbed = await rewriteQueryForSearch(q, detectedMk?.fullName);
    const embedding = await embedQueryPublic(queryForEmbed);

    // 4. Run all searches in parallel.
    //
    //    Primary: turn-level vector search for both MK and general queries.
    //    Date range from parseDateRange is applied to all searches.
    //    Vote vector search (Turso) merges with keyword results.

    const { dateFrom, dateTo } = dateRange;

    // Speaker turn vector search. When the ANN index errors (e.g. partial index from
    // ongoing insert workers), do NOT fall back to slow Turso LIKE scans — let the
    // session-level fallback below handle context instead.
    const committeeSearchPromise: Promise<
      Array<MkSpeakerTurnVec | MkSpeakerTurn>
    > = embedding
      ? searchSpeakerTurnsByVector(
          embedding,
          mkId ?? null,
          mkId ? 15 : 20,
          dateFrom,
          dateTo,
        ).catch(() => [])
      : Promise.resolve([]);

    const plenarySearchPromise: Promise<
      Array<PlenaryMkTurnVec | PlenaryMkTurn>
    > = embedding
      ? searchPlenaryTurnsByVector(
          embedding,
          mkId ? detectedMk!.fullName : null,
          mkId ? 8 : 12,
          dateFrom,
          dateTo,
        ).catch(() => [])
      : Promise.resolve([]);

    // Session-level fallback for ALL queries (MK and general).
    // Session embeddings are 100% complete and the index is stable.
    // This is the reliable fallback when turn-level ANN index is unhealthy.
    const sessionFallbackPromise: Promise<ProtocolSearchResult[]> = embedding
      ? searchProtocolsVec(embedding, null, mkId ? 5 : 8).catch(() => [])
      : searchProtocols(q, null, 1)
          .then((r) => r.results)
          .catch(() => []);

    // Vote vector search + keyword search, merged by voteId
    const voteVecPromise = embedding
      ? searchVotesByVector(embedding, 15, dateFrom, dateTo).catch(() => [])
      : Promise.resolve([]);

    /*
      ההקשר החדשותי הוא רקע חיצוני — הפרומפט עצמו אומר שהוא אינו חלק
      ממאגר הכנסת, והתשובה תקפה גם בלעדיו. ובכל זאת כל הבקשה המתינה לו:
      הוא יושב בתוך ה-Promise.all שחוסם גם את הצגת המקורות וגם את
      תחילת התשובה, ועם ניסיונות חוזרים הוא יכול היה להחזיק חצי דקה.

      דדליין קשיח: מה שלא הספיק עד DEADLINE פשוט לא נכנס. הקריאה
      עצמה ממשיכה ברקע ותיזרק, וזה בסדר — היא חסרת תופעות לוואי.
    */
    const NEWS_DEADLINE_MS = 3_500;
    const newsContextPromise: Promise<string> =
      topicKeywords.length > 0
        ? Promise.race([
            fetchNewsContext(
              topicPhrase || topicKeywords[0],
              detectedMk?.fullName,
            ).catch(() => ""),
            new Promise<string>((resolve) =>
              setTimeout(() => resolve(""), NEWS_DEADLINE_MS),
            ),
          ])
        : Promise.resolve("");

    const searchKeywords = stemmedKeywords.length > 0 ? stemmedKeywords : [q];

    const [
      committeeTurns,
      plenaryTurns,
      sessionFallback,
      voteVecResults,
      newsContext,
      votesKw,
      bills,
      queries,
    ] = await Promise.all([
      committeeSearchPromise,
      plenarySearchPromise,
      sessionFallbackPromise,
      voteVecPromise,
      newsContextPromise,
      Promise.resolve(
        searchVotesByKeyword(searchKeywords, mkId, 15, dateFrom, dateTo),
      ),
      Promise.resolve(
        searchBillsByKeyword(searchKeywords, mkId, 8, dateFrom, dateTo),
      ),
      Promise.resolve(
        searchQueriesByKeyword(searchKeywords, mkId, 8, dateFrom, dateTo),
      ),
    ]);

    // Merge vote vector results with keyword results (vector first, deduplicated)
    const voteVecIds = new Set(voteVecResults.map((v) => v.voteId));
    const votes = [
      ...voteVecResults
        .map((v) => {
          const kw = votesKw.find((k) => k.voteId === v.voteId);
          if (kw) return kw;
          const meta = getVoteMeta(v.voteId);
          return meta
            ? {
                voteId: v.voteId,
                title: meta.title,
                date: meta.date,
                isPassed: meta.isPassed,
                mkVoteResult: null,
                microAgenda: meta.microAgenda,
                macroAgenda: meta.macroAgenda,
              }
            : null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null),
      ...votesKw.filter((v) => !voteVecIds.has(v.voteId)),
    ].slice(0, 15);

    // 5. Build LLM context + collect sources
    let context = "";
    const sources: Source[] = [];
    const sessionSeen = new Set<number>();

    // MK profile
    if (mkId && detectedMk) {
      const mkInfo = getMkPerson(mkId);
      const positions = getMkPositions(mkId).filter((p) => p.isCurrent);
      if (mkInfo) {
        context += `[פרופיל: ${detectedMk.fullName}]\n`;
        if (mkInfo.factionName) context += `סיעה: ${mkInfo.factionName}\n`;
        const committees = positions
          .map((p) => p.committee || p.dutyDesc)
          .filter(Boolean)
          .slice(0, 5);
        if (committees.length > 0)
          context += `חברות בוועדות: ${committees.join(", ")}\n`;
        context += "\n";
      }
    }

    // Conversation context from previous turn
    if (hasPrevContext) {
      context += `[הקשר שיחה קודמת]\nשאלה: ${prevQ}\nתשובה: ${prevA.slice(0, 500)}\n\n`;
    }

    // Committee speaker turns
    for (const t of committeeTurns) {
      const speakerName =
        "speakerName" in t ? (t as MkSpeakerTurnVec).speakerName : "";
      const speaker = mkId && detectedMk ? detectedMk.fullName : speakerName;
      const label = speaker
        ? `${speaker} | ${t.date} | ${t.committeeName}`
        : `${t.date} | ${t.committeeName}`;

      if (!sessionSeen.has(t.sessionId)) {
        sessionSeen.add(t.sessionId);
        sources.push({
          type: "session",
          sessionId: t.sessionId,
          committeeName: t.committeeName,
          date: t.date,
          title: "",
          snippet: t.text.slice(0, 220),
        });
      }
      context += `[SESSION:${t.sessionId}] [${label}]\n${t.text}\n\n`;
      if (context.length > 18000) break;
    }

    // Session fallback (no embedding, general query)
    if (committeeTurns.length === 0 && sessionFallback.length > 0) {
      const topIds = [
        ...new Set(sessionFallback.map((r) => r.sessionId)),
      ].slice(0, 6);
      const docs = await Promise.all(
        topIds.map((id) => getProtocolSession(id)),
      );
      for (const doc of docs) {
        if (!doc) continue;
        const { session, chunks } = doc;
        if (!sessionSeen.has(session.sessionId)) {
          sessionSeen.add(session.sessionId);
          sources.push({
            type: "session",
            sessionId: session.sessionId,
            committeeName: session.committeeName ?? "",
            date: session.date,
            title: session.title ?? "",
          });
        }
        context += `[SESSION:${session.sessionId}] [${session.date} | ${session.committeeName ?? "ועדה"}]\n`;
        for (const chunk of chunks.slice(0, 60)) {
          if (chunk.speaker) context += `${chunk.speaker}: `;
          context += chunk.text.trim().replace(/\n{3,}/g, "\n") + "\n";
        }
        context += "\n";
        if (context.length > 18000) break;
      }
    }

    // Plenary turns
    if (plenaryTurns.length > 0) {
      context += `\n## דיון במליאה\n`;
      for (const t of plenaryTurns) {
        const speaker =
          t.speakerName || (mkId && detectedMk ? detectedMk.fullName : "");
        context += `• [SESSION:${t.sessionId}] ${t.date} — ${t.sessionName}${speaker ? ` — ${speaker}` : ""}\n  ${t.text.slice(0, 800)}\n`;
      }
    }

    // News context
    if (newsContext) {
      context += `\n## הקשר עיתונאי עדכני (רקע חיצוני — אינו חלק ממאגר הכנסת)\n${newsContext}\n`;
    }

    if (votes.length > 0) {
      context += "\n[הצבעות]\n";
      const factionId = detectedMk ? getMkFactionId(detectedMk.mkId) : null;
      const factionVoteCtx = factionId
        ? getVoteFactionContext(
            votes.slice(0, 10).map((v) => v.voteId),
            factionId,
          )
        : new Map();
      for (const v of votes.slice(0, 10)) {
        sources.push({
          type: "vote",
          voteId: v.voteId,
          title: v.title,
          date: v.date,
          isPassed: v.isPassed,
        });
        const agenda = v.microAgenda ? ` (${v.microAgenda})` : "";
        const mkDir = v.mkVoteResult ? ` — הצביע ${v.mkVoteResult}` : "";
        const fc = factionVoteCtx.get(v.voteId);
        const factionLine = fc
          ? ` | סיעה: ${fc.totalFor} בעד / ${fc.totalAgainst} נגד${fc.rebelCount > 0 ? ` (${fc.rebelCount} מרדו)` : " (קו מפלגתי)"}`
          : "";
        context += `[VOTE:${v.voteId}] ${v.date} — ${v.title}${agenda} — ${v.isPassed ? "עבר" : "לא עבר"}${mkDir}${factionLine}\n`;
      }
    }

    if (bills.length > 0) {
      context += "\n[הצעות חוק]\n";
      for (const b of bills.slice(0, 5)) {
        sources.push({
          type: "bill",
          billId: b.billId,
          title: b.title,
          committeeName: b.committeeName,
          isPassed: b.isPassed,
        });
        context += `[BILL:${b.billId}] ${b.title}${b.isPassed ? " (עבר)" : ""}\n`;
      }
    }

    if (queries.length > 0) {
      context += "\n[שאילתות פרלמנטריות]\n";
      for (const qr of queries.slice(0, 5)) {
        sources.push({
          type: "query",
          queryId: qr.queryId,
          title: qr.title,
          submitDate: qr.submitDate,
          mkName: qr.mkName,
        });
        const bodyExcerpt = qr.body ? `\n  תוכן: ${qr.body.slice(0, 250)}` : "";
        const responseNote = qr.ministryResponse
          ? `\n  תשובה: ${qr.ministryResponse.slice(0, 150)}`
          : "";
        context += `• ${qr.submitDate} — ${qr.title}${bodyExcerpt}${responseNote}\n`;
      }
    }

    if (context.trim().length < 50) {
      return NextResponse.json({
        answer: "לא נמצא מידע רלוונטי לשאלה זו בנתוני הכנסת.",
        sources: [],
        detectedMk,
        topicKeywords: [],
      });
    }

    // 6. Stream Gemini
    const systemPrompt = detectedMk
      ? SYSTEM_PROMPT_MK_TOPIC
      : SYSTEM_PROMPT_GENERAL;
    const enc = new TextEncoder();

    // Date range label for multi-turn banner (passed back to client)
    const dateLabel = dateRange.dateFrom
      ? `${dateRange.dateFrom.slice(0, 7)} – ${(dateRange.dateTo ?? "").slice(0, 7)}`
      : "";

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: object) =>
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

        const suggestionsPromise = generateSuggestions(q);

        try {
          send({
            type: "meta",
            sources,
            detectedMk: detectedMk ?? null,
            topicKeywords,
            dateLabel,
            hasPrevContext,
          });

          // Compose user message — include conversation context if present
          const prevBlock = hasPrevContext
            ? `\n[שיחה קודמת]\nשאלה: ${prevQ}\nתשובה: ${prevA.slice(0, 400)}\n\n`
            : "";
          const userMessage = `${prevBlock}שאלה: ${q}\n\n[נתוני כנסת]\n${context}`;

          let answer = "";
          for await (const chunk of streamGemini(userMessage, systemPrompt)) {
            answer += chunk;
            send({ type: "chunk", text: chunk });
          }
          send({ type: "done" });

          const suggestions = await suggestionsPromise;
          if (suggestions.length > 0)
            send({ type: "suggestions", questions: suggestions });

          /*
            רק תשובה שנראית שלמה נכנסת לקאש. תשובה קטועה שנשמרת
            הופכת לקבועה: כל מי ששואל את אותה שאלה מקבל אותה בחזרה
            בלי קריאה חדשה, ובלי שום סימן שמשהו נכשל. זה מה שקרה
            לשאלה על דיור, שהחזירה "על פי המקורות ש" ונתקעה שם.
          */
          const looksComplete = answer.trim().length >= 80;
          if (!looksComplete) {
            console.warn(`ask: תשובה קצרה מדי לקאש (${answer.trim().length} תווים)`);
          }
          if (!hasPrevContext && looksComplete) {
            await setCached(cacheKey, {
              answer,
              sources,
              detectedMk: detectedMk ?? null,
              topicKeywords,
            });
          }
        } catch (e) {
          /*
            ההודעה ״שגיאה בשירות ה-AI: Gemini 503״ אמרה למשתמשת את קוד
            ה-HTTP ולא מה לעשות איתו. אחרי שהניסיונות החוזרים נגמרו,
            503 ו-504 עדיין פירושם עומס אצל ספק המודל — כלומר ״נסי שוב״
            הוא באמת העצה הנכונה, ולא ״משהו אצלנו שבור״.
          */
          /*
            שלושה מצבים שונים, ולמשתמשת חשוב מאוד להבדיל ביניהם:
            מכסה יומית שנגמרה לא תשתחרר בניסיון חוזר, ולומר לה
            ״נסי שוב בעוד רגע״ זה לשלוח אותה ללחוץ עד מחר.
          */
          const msg = e instanceof Error ? e.message : String(e);
          let userMsg: string;
          if (e instanceof DailyQuotaError) {
            userMsg =
              "מכסת השאלות היומית של שירות ה-AI נוצלה. " +
              "היא מתאפסת מחר — שאר האתר עובד כרגיל.";
            console.error(`ask: מכסה יומית (${e.quotaValue ?? "?"} בקשות)`);
          } else if (msg === "RATE_LIMIT" || msg === "OVERLOADED") {
            userMsg = "שירות ה-AI עמוס כרגע. נסי שוב בעוד רגע — השאלה נשמרה בתיבה.";
          } else if (msg.startsWith("TRUNCATED:") || msg === "EMPTY") {
            // המודל נעצר באמצע. זו לא תקלת רשת ולא עומס — ניסוח אחר עשוי לעבוד.
            userMsg =
              "התשובה נקטעה באמצע. נסי לשאול שוב, או לצמצם את השאלה " +
              "לנושא אחד.";
            console.error("ask:", msg);
          } else {
            userMsg = "לא הצלחנו לייצר תשובה כרגע. אפשר לנסות לנסח את השאלה אחרת.";
            console.error("ask failed:", msg);
          }
          send({ type: "error", message: userMsg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("ask error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
