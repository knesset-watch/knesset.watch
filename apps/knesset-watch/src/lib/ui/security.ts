/**
 * Minimal DB Security Headers
 * Implements a strict Content Security Policy (CSP)
 */
export function getSecurityHeaders() {
  const csp = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https://*.wikipedia.org https://*.wikimedia.org https://*.googleusercontent.com;
    font-src 'self';
    connect-src 'self' https://*.wikimedia.org https://en.wikipedia.org https://he.wikipedia.org;
    media-src 'none';
    object-src 'none';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `.replace(/\s+/g, ' ').trim();

  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}
