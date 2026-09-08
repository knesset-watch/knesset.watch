import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/ui/rate-limit';

const KNESSET_ORIGIN = 'https://knesset.gov.il';
const PROXY_BASE = process.env.KNESSET_PROXY_URL ?? KNESSET_ORIGIN;

export async function GET(request: Request) {
  const { isLimited } = rateLimit(request, { limit: 20, windowMs: 60_000 });
  if (isLimited) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  if (!path) return NextResponse.json({ error: 'Path required' }, { status: 400 });

  const url = `${PROXY_BASE}/OdataV4/ParliamentInfo/${path}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store'
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      return NextResponse.json({ error: 'Non-JSON response', status: response.status, contentType, preview: text.slice(0, 500) }, { status: 502 });
    }
    if (!response.ok) throw new Error(`Knesset API ${response.status}`);
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('knesset-raw error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
