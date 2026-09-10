import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Generates a secure session token by hashing the password with a server secret.
 * This ensures the plain-text password is never stored in the browser.
 */
/**
 * עקיפת שער הסיסמה בפיתוח מקומי בלבד.
 *
 * שני תנאים נדרשים יחד, ושניהם חייבים להתקיים:
 *   1. NODE_ENV הוא development — next build ו-next start קובעים production,
 *      ולכן פריסה לעולם לא תעמוד בתנאי הזה
 *   2. DISABLE_AUTH=true הוצהר במפורש ב-.env.local, שאינו נכנס לגיט
 *
 * בלי שניהם ההתנהגות זהה לחלוטין לקודמת.
 */
function devAuthBypass(): boolean {
  const on = process.env.NODE_ENV === 'development' && process.env.DISABLE_AUTH === 'true';
  if (on && !warnedOnce) {
    warnedOnce = true;
    console.warn('[Auth] DISABLE_AUTH=true — שער הסיסמה עקוף. פיתוח מקומי בלבד.');
  }
  return on;
}

let warnedOnce = false;

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
  if (devAuthBypass()) return { isAllowed: true };

  const { pathname } = request.nextUrl;
  const rawSitePassword = process.env[passwordEnvVar] || '';
  const sitePassword = rawSitePassword.trim();

  // No password configured — the site is public.
  if (!sitePassword) {
    return { isAllowed: true };
  }

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
  if (devAuthBypass()) return true;

  const sitePassword = (process.env[passwordEnvVar] || '').trim();
  if (!sitePassword) return true;

  const cookieStore = await cookies();
  const authToken = cookieStore.get(cookieName);
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
  if (devAuthBypass()) return null;

  const sitePassword = (process.env[passwordEnvVar] || '').trim();
  if (!sitePassword) return null;

  const cookieStore = await cookies();
  const authToken = cookieStore.get(cookieName);
  const expectedToken = generateSessionToken(sitePassword);

  if (!authToken || authToken.value !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized API Access' }, { status: 401 });
  }
  return null;
}
