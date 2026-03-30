import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateAuth } from '@minimal-db/ui/auth-utils';

export function middleware(request: NextRequest) {
  const { isAllowed, redirectTo } = validateAuth(
    request,
    'SITE_PASSWORD',
    '/login',
    'knesset-watch_auth_token',
  );

  if (!isAllowed && redirectTo) {
    const loginUrl = new URL(redirectTo, request.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
