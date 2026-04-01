import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getFactionDetail, dbAvailable } from '@/lib/knesset-db';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') ?? '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  if (!dbAvailable()) return NextResponse.json({ error: 'Database not available' }, { status: 503 });

  try {
    const faction = getFactionDetail(name);
    if (!faction) return NextResponse.json({ error: 'Faction not found' }, { status: 404 });
    return NextResponse.json(faction);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
