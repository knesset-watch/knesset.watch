import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authDelay, rateLimit } from '@/lib/ui/rate-limit';
import { generateSessionToken } from '@/lib/ui/auth-utils';

export async function POST(request: Request) {
  const { password: rawPassword } = await request.json();
  const password = (rawPassword || '').trim().toLowerCase();
  const sitePassword = (process.env.SITE_PASSWORD || '').trim().toLowerCase();

  // 1. Check Rate Limit
  const { isLimited } = rateLimit(request, { limit: 5, windowMs: 60000 });
  if (isLimited) {
    return NextResponse.json({ error: 'Too many attempts.' }, { status: 429 });
  }

  // 3. Comparison
  if (password && password === sitePassword) {
    const cookieStore = await cookies();
    const secureToken = generateSessionToken(sitePassword);
    
    cookieStore.set('knesset-watch_auth_token', secureToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/knesset-watch',
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ success: true, token: secureToken });
  }

  // 4. Failed: Delay
  await authDelay(2000);
  return NextResponse.json({ success: false, error: 'Invalid credentials.' }, { status: 401 });
}
