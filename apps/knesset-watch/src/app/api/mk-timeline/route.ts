import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { findMkInText, getMkTopicTimeline } from '@/lib/knesset-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const kwParam = req.nextUrl.searchParams.get('kw') ?? '';

  const mk = findMkInText(q);
  if (!mk) return NextResponse.json({ events: [], mkName: null });

  const keywords = kwParam.split(',').filter(Boolean);
  const events = getMkTopicTimeline(mk.mkId, keywords.length ? keywords : [q], 20);

  return NextResponse.json({ events, mkName: mk.fullName });
}
