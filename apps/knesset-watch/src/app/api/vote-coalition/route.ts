import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getVoteCoalition } from '@/lib/knesset-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const voteId = Number(req.nextUrl.searchParams.get('voteId'));
  if (!voteId) return NextResponse.json({ error: 'Missing voteId' }, { status: 400 });

  const data = getVoteCoalition(voteId);
  if (!data) return NextResponse.json({ error: 'Vote not found' }, { status: 404 });

  return NextResponse.json(data);
}
