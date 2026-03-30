import { NextResponse } from 'next/server';

const KNESSET_API_BASE = (process.env.KNESSET_PROXY_URL ?? 'https://knesset.gov.il') + '/OdataV4/ParliamentInfo';

const K25_START = '2022-11-15T00:00:00+02:00';
const MAX_PAGES = 1; // single request (~100 votes); Vercel Hobby timeout is 10s

interface VoteResult {
  Id: number;
  MkId: number;
  VoteID: number;
  VoteDate: string;
  ResultCode: number;
  ResultDesc: string;
  LastName: string;
  FirstName: string;
  SessionID: number;
  ItemID: number;
  Vote?: {
    Id: number;
    VoteDateTime: string;
    VoteTitle: string;
    VoteSubject: string;
    IsNoConfidenceInGov: boolean | null;
    ForOptionDesc: string;
    AgainstOptionDesc: string;
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mkId = searchParams.get('mkId');

  if (!mkId || !/^\d+$/.test(mkId)) {
    return NextResponse.json({ error: 'mkId is required' }, { status: 400 });
  }

  const filter = `MkId eq ${mkId} and VoteDate ge ${K25_START}`;
  const firstUrl =
    `${KNESSET_API_BASE}/KNS_PlenumVoteResult` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$expand=Vote&$orderby=VoteDate desc&$count=true`;

  try {
    const all: VoteResult[] = [];
    let total = 0;
    let next: string | null = firstUrl;
    let pages = 0;

    while (next && pages < MAX_PAGES) {
      const res: Response = await fetch(next, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`Knesset API ${res.status}`);

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        const body = await res.text();
        throw new Error(`Knesset returned non-JSON (${contentType}): ${body.slice(0, 200)}`);
      }

      const data: {
        '@odata.count'?: number;
        '@odata.nextLink'?: string;
        value?: VoteResult[];
      } = await res.json();

      if (pages === 0 && data['@odata.count'] != null) {
        total = data['@odata.count'];
      }
      all.push(...(data.value ?? []));
      next = data['@odata.nextLink'] ?? null;
      pages++;
    }

    // Deduplicate by VoteID (API occasionally returns duplicates)
    const seen = new Set<number>();
    const votes = all.filter(v => {
      if (seen.has(v.VoteID)) return false;
      seen.add(v.VoteID);
      return true;
    });

    return NextResponse.json({ votes, total });
  } catch (err: any) {
    console.error('votes fetch error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
