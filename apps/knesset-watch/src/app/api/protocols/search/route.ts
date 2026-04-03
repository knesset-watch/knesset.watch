import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { searchProtocols } from '@/lib/protocols-db';

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = req.nextUrl;
  const q = (searchParams.get('q') ?? '').trim();
  const committee = searchParams.get('committee') || null;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const from = searchParams.get('from') || null;
  const to   = searchParams.get('to')   || null;

  if (!q) return NextResponse.json({ results: [], total: 0, page });

  const data = await searchProtocols(q, committee, page, from, to);
  return NextResponse.json(data);
}
