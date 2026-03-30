import { NextResponse } from 'next/server';

const KNESSET_ORIGIN = 'https://knesset.gov.il';
const PROXY_BASE = (process.env.KNESSET_PROXY_URL ?? KNESSET_ORIGIN) + '/OdataV4/ParliamentInfo';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  if (!path) return NextResponse.json({ error: 'Path is required' }, { status: 400 });

  const knessetUrl = `${PROXY_BASE}/${path}`;

  try {
    const response = await fetch(knessetUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 }
    });

    if (!response.ok) throw new Error(`Knesset API Error ${response.status}`);

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
