import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BASE_PATH: '',
  },
  transpilePackages: ['@minimal-db/ui', '@minimal-db/db'],
  // Prevent Next.js from bundling native modules — they must stay as-is
  serverExternalPackages: ['better-sqlite3'],
  // Include the SQLite database file in every API route's deployment bundle
  outputFileTracingIncludes: {
    '/api/**/*': ['./knesset.db'],
  },
};

export default nextConfig;
