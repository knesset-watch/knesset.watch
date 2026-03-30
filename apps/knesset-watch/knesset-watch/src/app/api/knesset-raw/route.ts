import { NextResponse } from 'next/server';

const KNESSET_ORIGIN = 'https://knesset.gov.il';
const PROXY_BASE = process.env.KNESSET_PROXY_URL ?? KNESSET_ORIGIN;

export async function GET(request: Request) {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
