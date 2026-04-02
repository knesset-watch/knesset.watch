import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getVoteList, dbAvailable } from '@/lib/knesset-db';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) return NextResponse.json({ error: 'Database not available' }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const passedOnly = searchParams.get('passed') === '1';
  const failedOnly = searchParams.get('failed') === '1';
  const maxMarginStr = searchParams.get('maxMargin');
  const maxMargin = maxMarginStr ? parseInt(maxMarginStr, 10) : undefined;
  const search = searchParams.get('q') ?? undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  try {
    const result = getVoteList({ passedOnly, failedOnly, maxMargin, search, limit, offset, from, to });
    return NextResponse.json({ ...result, page, limit });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
