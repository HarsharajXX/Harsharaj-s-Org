import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { COMMUNITIES, PRODUCTS } from '../data/mockData';
import { Community, Product } from '../types';

export const databaseService = {
  async getCommunities(): Promise<{ data: Community[]; mode: 'live' | 'demo'; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { data: COMMUNITIES, mode: 'demo' };
    }
    try {
      const { data, error } = await supabase
        .from('communities')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        return { data: COMMUNITIES, mode: 'demo', error: error.message };
      }
      if (!data || data.length === 0) {
        return { data: COMMUNITIES, mode: 'demo' };
      }
      return { data: data as unknown as Community[], mode: 'live' };
    } catch (err) {
      return {
        data: COMMUNITIES,
        mode: 'demo',
        error: err instanceof Error ? err.message : 'Failed to fetch communities',
      };
    }
  },

  async getPublishedProducts(): Promise<{ data: Product[]; mode: 'live' | 'demo'; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { data: PRODUCTS, mode: 'demo' };
    }
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('approval_status', 'approved')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

      if (error) {
        return { data: PRODUCTS, mode: 'demo', error: error.message };
      }
      if (!data || data.length === 0) {
        return { data: PRODUCTS, mode: 'demo' };
      }
      return { data: data as unknown as Product[], mode: 'live' };
    } catch (err) {
      return {
        data: PRODUCTS,
        mode: 'demo',
        error: err instanceof Error ? err.message : 'Failed to fetch products',
      };
    }
  },
};
