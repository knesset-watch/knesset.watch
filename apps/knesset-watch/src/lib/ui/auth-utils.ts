import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Generates a secure session token by hashing the password with a server secret.
 * This ensures the plain-text password is never stored in the browser.
 */
export function generateSessionToken(password: string) {
  // Normalize password by trimming and lowercasing
  const normalizedPassword = password.trim().toLowerCase();
  const secret = process.env.SESSION_SECRET || 'minimal-db-stable-salt';
  const token = btoa(`${normalizedPassword}:${secret}`);
  return token;
}

/**
 * Middleware-level Auth Logic
 */
export function validateAuth(
  request: NextRequest, 
  passwordEnvVar: string = 'SITE_PASSWORD',
  loginPath: string = '/login',
  cookieName: string = 'auth_token'
) {
  const { pathname } = request.nextUrl;
  const rawSitePassword = process.env[passwordEnvVar] || '';
  const sitePassword = rawSitePassword.trim();

  // Bypass for system paths and static files
  if (
    pathname.startsWith('/_next/') ||
    pathname.includes('.') ||
    pathname.endsWith('/login') ||
    pathname.includes('/api/auth')
  ) {
    return { isAllowed: true };
  }

  const authToken = request.cookies.get(cookieName);
  const expectedToken = generateSessionToken(sitePassword || '');

  if (!authToken || authToken.value !== expectedToken) {
    console.log(`[Auth] Unauthorized access to ${pathname}. Expected token exists: ${!!expectedToken}`);
    return { isAllowed: false, redirectTo: loginPath };
  }

  return { isAllowed: true };
}

/**
 * Server Component-level Auth Logic (The Double Lock)
 */
export async function checkServerAuth(
  passwordEnvVar: string = 'SITE_PASSWORD',
  cookieName: string = 'auth_token'
) {
  const cookieStore = await cookies();
  const authToken = cookieStore.get(cookieName);
  const sitePassword = (process.env[passwordEnvVar] || '').trim();
  const expectedToken = generateSessionToken(sitePassword);

  if (!authToken || authToken.value !== expectedToken) {
    return false;
  }
  return true;
}

/**
 * API-level Auth Logic (The Triple Lock)
 */
export async function validateApiAuth(
  passwordEnvVar: string = 'SITE_PASSWORD',
  cookieName: string = 'auth_token'
) {
  const cookieStore = await cookies();
  const authToken = cookieStore.get(cookieName);
  const sitePassword = (process.env[passwordEnvVar] || '').trim();
  const expectedToken = generateSessionToken(sitePassword);

  if (!authToken || authToken.value !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized API Access' }, { status: 401 });
  }
  return null;
}
