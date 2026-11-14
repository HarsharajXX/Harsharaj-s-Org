import { createClient, SupabaseClient } from '@supabase/supabase-js';

const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;

const supabaseUrl =
  metaEnv?.VITE_SUPABASE_URL ||
  metaEnv?.NEXT_PUBLIC_SUPABASE_URL ||
  '';

const supabaseAnonKey =
  metaEnv?.VITE_SUPABASE_ANON_KEY ||
  metaEnv?.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getBackendStatus() {
  return {
    mode: isSupabaseConfigured ? ('live' as const) : ('demo' as const),
    message: isSupabaseConfigured
      ? 'Connected to Supabase PostgreSQL & Auth.'
      : 'Running in Demo Mode (Supabase credentials not configured).',
  };
}
