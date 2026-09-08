import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/ui/rate-limit';

export async function GET(request: Request) {
  const { isLimited } = rateLimit(request, { limit: 10, windowMs: 60_000 });
  if (isLimited) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const v2Url = 'https://knesset.gov.il/OData/KnessetData.svc/KNS_Bill?$top=1';
  const v4Url = 'https://knesset.gov.il/OdataV4/ParliamentInfo/KNS_Bill?$top=1';

  const results: any = {};

  try {
    const r2 = await fetch(v2Url, { headers: { 'Accept': 'application/json' }, next: { revalidate: 0 } });
    results.v2 = { status: r2.status, ok: r2.ok };
  } catch (e: any) { results.v2 = { error: e.message }; }

  try {
    const r4 = await fetch(v4Url, { headers: { 'Accept': 'application/json' }, next: { revalidate: 0 } });
    results.v4 = { status: r4.status, ok: r4.ok };
  } catch (e: any) { results.v4 = { error: e.message }; }

  return NextResponse.json(results);
}
