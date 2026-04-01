import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable, searchAll } from '@/lib/knesset-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }
  if (q.length > 100) {
    return NextResponse.json({ error: 'שאילתה ארוכה מדי' }, { status: 400 });
  }

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const results = searchAll(q);
  return NextResponse.json({ results });
}
