/**
 * Server-side feature flags. Not exposed to the client bundle — gate
 * pages/routes in server components and API routes, and thread the
 * result down as a prop where a client component needs to know.
 */

export function aiFeaturesEnabled(): boolean {
  return process.env.AI_FEATURES_ENABLED !== 'false';
}
