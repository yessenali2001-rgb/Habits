/** Central place for reading configuration, so a missing variable produces a helpful message, not a crash. */

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export function supabaseConfig(): { url: string; anon: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anon ? { url, anon } : null;
}
export const isSupabaseConfigured = () => supabaseConfig() !== null;

/** Server-only features. Each returns false (and the UI hides the feature) until configured. */
export const serviceRoleConfigured = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;
export const feedsConfigured = () =>
  serviceRoleConfigured() && !!process.env.FEED_SIGNING_SECRET;
export const googleConfigured = () =>
  serviceRoleConfigured() && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET &&
  !!process.env.TOKEN_ENCRYPTION_KEY && !!process.env.FEED_SIGNING_SECRET;
export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
