/**
 * supabase-auth.js — unchanged from previous version
 */
const SUPABASE_URL = 'https://wkdwjhpeaahonuixqgwq.supabase.co';

export async function verifySupabaseToken(idToken, env) {
  if (!idToken) throw new Error('Missing Supabase access token');
  if (!env.SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_KEY');

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'apikey':        env.SUPABASE_SERVICE_KEY,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.msg || data?.message || 'Supabase token verification failed');

  const user = data;
  if (!user?.id) throw new Error('Supabase token verification failed: no user id returned');

  return {
    uid:           user.id,
    email:         user.email                                              || null,
    emailVerified: !!(user.email_confirmed_at),
    displayName:   user.user_metadata?.display_name || user.user_metadata?.full_name || null,
    photoUrl:      user.user_metadata?.avatar_url                         || null,
    disabled:      user.banned_until ? new Date(user.banned_until) > new Date() : false,
    raw:           user,
  };
}
