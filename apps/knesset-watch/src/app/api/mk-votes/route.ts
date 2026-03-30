import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getMkVotesFromDb, dbAvailable } from '@/lib/knesset-db';

const KNESSET_API_BASE = (process.env.KNESSET_PROXY_URL ?? 'https://knesset.gov.il') + '/OdataV4/ParliamentInfo';
const K25_START = '2022-11-15T00:00:00+02:00';

const CODE_TO_LABEL: Record<number, string> = {
  6: 'נוכח', 7: 'בעד', 8: 'נגד', 9: 'נמנע',
};

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const mkIdStr = searchParams.get('mkId');
  if (!mkIdStr || !/^\d+$/.test(mkIdStr)) {
    return NextResponse.json({ error: 'mkId required' }, { status: 400 });
  }
  const mkId = parseInt(mkIdStr, 10);

  // Prefer local SQLite — includes pass/fail context for each vote
  if (dbAvailable()) {
    const rows = getMkVotesFromDb(mkId);
    return NextResponse.json({
      source: 'db',
      votes: rows.map(r => ({
        ...r,
        resultLabel: CODE_TO_LABEL[r.resultCode] ?? 'נוכח',
      })),
    });
  }

  // Fallback: live Knesset API (first page, no pass/fail context)
  try {
    const filter = `MkId eq ${mkId} and VoteDate ge ${K25_START}`;
    const url =
      `${KNESSET_API_BASE}/KNS_PlenumVoteResult` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$expand=Vote($select=VoteTitle)` +
      `&$select=VoteID,VoteDate,ResultDesc` +
      `&$orderby=VoteDate desc`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Knesset API ${res.status}`);
    const data = await res.json();

    const seen = new Set<number>();
    const votes = (data.value ?? [])
      .filter((r: any) => {
        if (seen.has(r.VoteID)) return false;
        seen.add(r.VoteID);
        return true;
      })
      .map((r: any) => ({
        voteId: r.VoteID,
        title: r.Vote?.VoteTitle ?? '',
        date: r.VoteDate,
        resultCode: null,
        resultLabel: r.ResultDesc,
        isPassed: null,
        totalFor: null,
        totalAgainst: null,
      }));

    return NextResponse.json({ source: 'api', votes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
