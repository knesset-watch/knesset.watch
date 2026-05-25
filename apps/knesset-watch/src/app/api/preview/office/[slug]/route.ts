import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getOfficeDetail } from '@/lib/knesset-db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { slug } = await params;
  const office = getOfficeDetail(slug);

  if (!office) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const currentHolder = office.currentHolders[0]?.personName ?? null;

  return NextResponse.json({
    slug: office.slug,
    displayName: office.displayName,
    currentHolder,
    totalHolders: office.distinctHolderCount,
    tenures: office.timeline.length,
  });
}
