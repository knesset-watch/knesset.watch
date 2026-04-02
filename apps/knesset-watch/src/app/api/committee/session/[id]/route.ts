import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getCommitteeSessionDetail } from '@/lib/knesset-db';
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

  // Fetch SQLite detail and Turso transcript in parallel
  const [detail, protocol] = await Promise.all([
    Promise.resolve(getCommitteeSessionDetail(sessionId)),
    getProtocolSession(sessionId),
  ]);

  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    agendaItems: detail.agendaItems,
    votes: detail.votes,
    linkedBills: detail.linkedBills,
    documents: detail.documents,
    chunks: protocol?.chunks ?? [],
  });
}
