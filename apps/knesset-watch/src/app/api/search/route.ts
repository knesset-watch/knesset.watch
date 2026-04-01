import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable, searchAll } from '@/lib/knesset-db';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (q.length < 2) return NextResponse.json({ results: [] });
  if (q.length > 100) return NextResponse.json({ error: 'שאילתה ארוכה מדי' }, { status: 400 });

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  try {
    const results = searchAll(q);
    return NextResponse.json({ results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Search error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
