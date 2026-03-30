/**
 * Minimal DB Sanitized Logger
 * Prevents sensitive strings from being printed to the console
 */
export const logger = {
  log: (...args: any[]) => {
    if (process.env.NODE_ENV === 'production') return;
    console.log(...args.map(sanitize));
  },
  error: (...args: any[]) => {
    console.error(...args.map(sanitize));
  },
  warn: (...args: any[]) => {
    console.warn(...args.map(sanitize));
  }
};

function sanitize(input: any): any {
  if (typeof input !== 'string') return input;

  // Mask common sensitive patterns
  const sensitivePatterns = [
    /AIzaSy[A-Za-z0-9_-]{33}/g, // Google API Keys
    /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, // Private Keys
    /bearer\s+[A-Za-z0-9._-]+/gi, // Bearer Tokens
    /password=[^&]+/gi, // Connection string passwords
  ];

  let output = input;
  sensitivePatterns.forEach(pattern => {
    output = output.replace(pattern, '[REDACTED SECRET]');
  });

  return output;
}
