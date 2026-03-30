import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { getProtocolSession } from '@/lib/protocols-db';

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Props) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const data = await getProtocolSession(sessionId);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(data);
}
