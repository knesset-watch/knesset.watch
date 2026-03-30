import { NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { dbAvailable, getBills } from '@/lib/knesset-db';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const passedOnly = searchParams.get('passedOnly') === 'true';
  const q = searchParams.get('q') ?? undefined;
  const committee = searchParams.get('committee') ?? undefined;
  const year = searchParams.get('year') ?? undefined;

  try {
    const result = getBills({ limit, offset, passedOnly, q, committee, year });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Bills DB error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
