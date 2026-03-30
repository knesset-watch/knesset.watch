import { NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { dbAvailable, getMkPresenceHeatmap } from '@/lib/knesset-db';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const mkId = parseInt(searchParams.get('mkId') || '0', 10);

  if (!mkId || !dbAvailable()) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const heatmap = getMkPresenceHeatmap(mkId);
    return NextResponse.json({ heatmap });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
