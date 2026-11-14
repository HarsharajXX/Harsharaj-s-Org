import { createClient } from '@supabase/supabase-js';
import { SupabasePaymentEdgeRepository, type SupabaseLikeClient } from './supabaseRepo.ts';

export function createServiceRoleRepository(): {
  repo: SupabasePaymentEdgeRepository;
  serviceRoleKey: string;
} {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in Edge Function secrets.');
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return {
    repo: new SupabasePaymentEdgeRepository(client as unknown as SupabaseLikeClient),
    serviceRoleKey,
  };
}
