import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable, getNetworkGraph } from '@/lib/knesset-db';

export async function GET() {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) return NextResponse.json({ error: 'Database not available' }, { status: 503 });

  try {
    const graph = getNetworkGraph();
    return NextResponse.json(graph);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
