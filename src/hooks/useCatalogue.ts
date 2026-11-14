import { useEffect, useState } from 'react';
import { Community, Product } from '../types';
import { databaseService } from '../services/database';

interface CatalogueState {
  communities: Community[];
  products: Product[];
  loading: boolean;
  mode: 'live' | 'demo';
  error: string | null;
}

export function useCatalogue(): CatalogueState {
  const [state, setState] = useState<CatalogueState>({
    communities: [],
    products: [],
    loading: true,
    mode: databaseService.isLive() ? 'live' : 'demo',
    error: null,
  });

  useEffect(() => {
    let active = true;
    async function load() {
      const [commRes, prodRes] = await Promise.all([
        databaseService.getCommunities(),
        databaseService.getPublishedProducts(),
      ]);
      if (!active) return;

      const errorMsg = commRes.error || prodRes.error || null;
      setState({
        communities: commRes.data,
        products: prodRes.data,
        loading: false,
        mode: prodRes.mode,
        error: errorMsg,
      });
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
