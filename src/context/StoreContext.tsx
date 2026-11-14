import React, { createContext, useContext, useEffect, useState } from 'react';
import { CartItem, CustomerUser, Order, Product, UserRole } from '../types';
import { PRODUCTS } from '../data/mockData';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { databaseService } from '../services/database';
import { AuthUser, authService } from '../services/auth';
import { prepareCheckoutItems } from '../utils/commerceRules';

export { prepareCheckoutItems };

interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'info' | 'error';
}

export function getCartItemKey(
  productId: string,
  variantId?: string,
  size?: string,
  colour?: string
): string {
  return `${productId}::${variantId || ''}::${size || ''}::${colour || ''}`;
}

interface StoreContextType {
  isLiveMode: boolean;
  cart: CartItem[];
  wishlist: string[];
  user: CustomerUser | null;
  orders: Order[];
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  addToCart: (
    product: Product,
    quantity?: number,
    size?: string,
    colour?: string,
    variantId?: string,
    unitPrice?: number
  ) => void;
  removeFromCart: (productId: string, itemKey?: string) => void;
  updateQuantity: (productId: string, quantity: number, itemKey?: string) => void;
  clearCart: () => void;
  cartCount: number;
  cartSubtotal: number;
  toggleWishlist: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
  wishlistProducts: Product[];
  setSessionUser: (authUser: AuthUser | null) => void;
  loginDemo: (email: string, name?: string, roles?: UserRole[]) => void;
  logout: () => Promise<void>;
  placeDemoOrder: (customerName: string, customerEmail: string, shippingAddress: string) => Order;
  placeLiveOrder: (params: {
    customerName: string;
    customerEmail: string;
    phone: string;
    line1: string;
    city: string;
    postalCode: string;
    paymentMethod: 'cod' | 'online';
  }) => Promise<{ orderId: string | null; error?: string }>;
  cancelOrder: (orderId: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
  requestOrderRefund: (params: {
    orderId: string;
    sellerOrderId?: string | null;
    items?: Array<{ order_item_id: string; quantity: number }> | null;
    amountPaise?: number | null;
    reason: string;
  }) => Promise<{ ok: boolean; refundId?: string; error?: string }>;
  refreshLiveState: () => Promise<void>;
  toasts: ToastMessage[];
  showToast: (text: string, type?: 'success' | 'info' | 'error') => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const CART_KEY = 'nohaj_cart';
const WISHLIST_KEY = 'nohaj_demo_wishlist';
const USER_KEY = 'nohaj_demo_user';
const ORDERS_KEY = 'nohaj_demo_orders';

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isLiveMode = isSupabaseConfigured && Boolean(supabase);

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [wishlist, setWishlist] = useState<string[]>(() => {
    if (isLiveMode) return [];
    try {
      const saved = localStorage.getItem(WISHLIST_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [user, setUser] = useState<CustomerUser | null>(() => {
    if (isLiveMode) return null;
    try {
      const saved = localStorage.getItem(USER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    if (isLiveMode) return [];
    try {
      const saved = localStorage.getItem(ORDERS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [liveProducts, setLiveProducts] = useState<Product[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Restore & subscribe to Supabase Auth session when configured
  useEffect(() => {
    if (!isLiveMode || !supabase) return;

    let active = true;

    async function hydrateLiveUser(uid: string, email: string, fullName: string) {
      if (!supabase) return;
      const [{ data: roleRows }, wishlistIds, ordersRes, prodRes] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', uid),
        databaseService.getWishlistProductIds(uid),
        databaseService.getCustomerOrders(uid),
        databaseService.getPublishedProducts(),
      ]);
      if (!active) return;

      const roles = (roleRows?.map((r: { role: string }) => r.role as UserRole) || ['customer']);
      setUser({
        id: uid,
        name: fullName,
        email,
        roles,
        saved_addresses: [],
        is_demo: false,
      });
      setWishlist(wishlistIds);
      if (ordersRes.mode === 'live') {
        setOrders(ordersRes.data);
      }
      setLiveProducts(prodRes.data);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        const u = data.session.user;
        hydrateLiveUser(
          u.id,
          u.email || '',
          (u.user_metadata?.full_name as string) || 'NOHAJ Member'
        );
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const u = session.user;
        hydrateLiveUser(
          u.id,
          u.email || '',
          (u.user_metadata?.full_name as string) || 'NOHAJ Member'
        );
      } else {
        setUser(null);
        setWishlist([]);
        setOrders([]);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [isLiveMode]);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!isLiveMode) {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
    }
  }, [wishlist, isLiveMode]);

  useEffect(() => {
    if (isLiveMode) return;
    if (user && user.is_demo) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else if (!user) {
      localStorage.removeItem(USER_KEY);
    }
  }, [user, isLiveMode]);

  useEffect(() => {
    if (!isLiveMode) {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    }
  }, [orders, isLiveMode]);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  const addToCart = (
    product: Product,
    quantity = 1,
    size?: string,
    colour?: string,
    variantId?: string,
    unitPrice?: number
  ) => {
    const selectedSize = size || product.sizes[0] || 'Free Size';
    const selectedColour = colour || product.colours[0] || 'Natural';
    const variants = product.variants || [];
    const matchedVariant =
      variants.length > 0
        ? (variantId ? variants.find((v) => v.id === variantId) : undefined) ||
          variants.find((v) => v.size === selectedSize && v.colour === selectedColour) ||
          variants[0]
        : undefined;

    if (variants.length === 0 && product.availability === 'Out of Stock') {
      showToast('This piece is currently out of stock.', 'error');
      return;
    }

    const resolvedVariantId = variantId ?? matchedVariant?.id;
    const maxStock = matchedVariant ? matchedVariant.stock_quantity : product.stock_quantity;
    if (typeof maxStock === 'number' && maxStock <= 0) {
      showToast('Selected option is currently out of stock.', 'error');
      return;
    }

    const effectiveUnitPrice = unitPrice ?? matchedVariant?.price_override ?? product.price;
    const targetKey = getCartItemKey(product.id, resolvedVariantId, selectedSize, selectedColour);

    setCart((prev) => {
      const existing = prev.find(
        (item) =>
          getCartItemKey(item.product.id, item.variantId, item.selectedSize, item.selectedColour) ===
          targetKey
      );
      const nextQty = existing ? existing.quantity + quantity : quantity;
      if (typeof maxStock === 'number' && nextQty > maxStock) {
        showToast(`Only ${maxStock} available in stock.`, 'error');
        return prev;
      }
      if (existing) {
        return prev.map((item) =>
          getCartItemKey(item.product.id, item.variantId, item.selectedSize, item.selectedColour) ===
          targetKey
            ? { ...item, quantity: nextQty, unitPrice: effectiveUnitPrice }
            : item
        );
      }
      return [
        ...prev,
        {
          product,
          quantity,
          selectedSize,
          selectedColour,
          variantId: resolvedVariantId,
          unitPrice: effectiveUnitPrice,
        },
      ];
    });
    showToast(`${product.name} added to your bag.`);
  };

  const removeFromCart = (productId: string, itemKey?: string) => {
    setCart((prev) =>
      prev.filter((item) =>
        itemKey
          ? getCartItemKey(item.product.id, item.variantId, item.selectedSize, item.selectedColour) !==
            itemKey
          : item.product.id !== productId
      )
    );
    showToast('Item removed from bag.', 'info');
  };

  const updateQuantity = (productId: string, quantity: number, itemKey?: string) => {
    if (quantity <= 0) {
      removeFromCart(productId, itemKey);
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        const matches = itemKey
          ? getCartItemKey(item.product.id, item.variantId, item.selectedSize, item.selectedColour) ===
            itemKey
          : item.product.id === productId;
        if (!matches) return item;

        const matchedVariant = item.variantId
          ? item.product.variants?.find((v) => v.id === item.variantId)
          : undefined;
        const maxStock = matchedVariant ? matchedVariant.stock_quantity : item.product.stock_quantity;

        if (typeof maxStock === 'number' && quantity > maxStock) {
          showToast(`Only ${maxStock} available in stock.`, 'error');
          return item;
        }
        return { ...item, quantity };
      })
    );
  };

  const clearCart = () => setCart([]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce(
    (sum, item) => sum + (item.unitPrice ?? item.product.price) * item.quantity,
    0
  );

  const toggleWishlist = async (productId: string) => {
    const exists = wishlist.includes(productId);
    if (isLiveMode && user && !user.is_demo) {
      const { error } = await databaseService.toggleWishlistItem(user.id, productId, !exists);
      if (error) {
        showToast(error, 'error');
        return;
      }
    }
    setWishlist((prev) => {
      if (exists) {
        showToast('Removed from wishlist.', 'info');
        return prev.filter((id) => id !== productId);
      }
      showToast('Saved to wishlist.');
      return [...prev, productId];
    });
  };

  const isInWishlist = (productId: string) => wishlist.includes(productId);

  const catalogueSource = isLiveMode ? liveProducts : PRODUCTS;
  const wishlistProducts = catalogueSource.filter((p) => wishlist.includes(p.id));

  const setSessionUser = (authUser: AuthUser | null) => {
    if (!authUser) {
      setUser(null);
      return;
    }
    setUser({
      id: authUser.id,
      name: authUser.fullName,
      email: authUser.email,
      phone: authUser.phone,
      roles: authUser.roles,
      saved_addresses: authUser.isDemo ? ['Guwahati, Assam 781001'] : [],
      is_demo: authUser.isDemo,
    });
  };

  const loginDemo = (email: string, name = 'Guest Patron', roles: UserRole[] = ['customer']) => {
    if (isLiveMode) {
      showToast('Demo login is disabled when connected to live Supabase.', 'error');
      return;
    }
    const inferredRoles: UserRole[] =
      roles.length > 0 ? roles : email.toLowerCase().includes('seller') ? ['seller'] : ['customer'];
    const demoUser: CustomerUser = {
      id: `demo-user-${inferredRoles[0]}`,
      name,
      email,
      roles: inferredRoles,
      saved_addresses: ['Guwahati, Assam 781001'],
      is_demo: true,
    };
    setUser(demoUser);
    showToast(`Signed in as ${name} (Demo Mode).`);
  };

  const logout = async () => {
    if (isLiveMode) {
      await authService.signOut();
    }
    setUser(null);
    if (isLiveMode) {
      setWishlist([]);
      setOrders([]);
    }
    showToast('Signed out.', 'info');
  };

  const placeDemoOrder = (
    customerName: string,
    customerEmail: string,
    shippingAddress: string
  ): Order => {
    const shippingAmount = cartSubtotal >= 5000 ? 0 : 250;
    const newOrder: Order = {
      id: `NHJ-${Math.floor(100000 + Math.random() * 900000)}`,
      order_number: `NHJ-${Math.floor(100000 + Math.random() * 900000)}`,
      customer_id: user?.id || 'guest-demo',
      customer_name: customerName,
      customer_email: customerEmail,
      shipping_address: shippingAddress,
      total: cartSubtotal + shippingAmount,
      shipping_amount: shippingAmount,
      payment_method: 'cod',
      status: 'Confirmed (Demo)',
      payment_status: 'Demo Checkout (COD)',
      items: cart.map((item, idx) => ({
        id: `oi-${idx}-${Date.now()}`,
        order_id: '',
        product_id: item.product.id,
        variant_id: item.variantId || null,
        product_name: item.product.name,
        seller_id: item.product.seller_id,
        quantity: item.quantity,
        unit_price: item.unitPrice ?? item.product.price,
      })),
      is_demo: true,
      created_at: new Date().toISOString(),
    };
    setOrders((prev) => [newOrder, ...prev]);
    clearCart();
    return newOrder;
  };

  const placeLiveOrder = async (params: {
    customerName: string;
    customerEmail: string;
    phone: string;
    line1: string;
    city: string;
    postalCode: string;
    paymentMethod: 'cod' | 'online';
  }): Promise<{ orderId: string | null; error?: string }> => {
    if (!isLiveMode || !user || user.is_demo) {
      return { orderId: null, error: 'Live authentication required to place a live order.' };
    }
    const res = await databaseService.createMultiVendorOrder({
      shippingAddress: {
        full_name: params.customerName,
        email: params.customerEmail,
        phone: params.phone,
        line1: params.line1,
        city: params.city,
        postal_code: params.postalCode,
      },
      paymentMethod: params.paymentMethod,
      items: prepareCheckoutItems(
        cart.map((c) => ({
          product_id: c.product.id,
          variant_id: c.variantId || null,
          quantity: c.quantity,
        }))
      ),
    });

    if (res.orderId) {
      clearCart();
      const [refreshedOrders, refreshedProducts] = await Promise.all([
        databaseService.getCustomerOrders(user.id),
        databaseService.getPublishedProducts(),
      ]);
      if (refreshedOrders.mode === 'live') {
        setOrders(refreshedOrders.data);
      }
      if (refreshedProducts.mode === 'live') {
        setLiveProducts(refreshedProducts.data);
      }
    }
    return res;
  };

  const cancelOrder = async (
    orderId: string,
    reason = 'Cancelled by customer'
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!isLiveMode) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status: 'cancelled',
                cancelled_at: new Date().toISOString(),
                cancellation_reason: reason,
              }
            : o
        )
      );
      showToast('Order cancelled (Demo Mode).', 'info');
      return { ok: true };
    }
    if (!user || user.is_demo) {
      return { ok: false, error: 'Sign in required to cancel an order.' };
    }
    const res = await databaseService.cancelCustomerOrder(orderId, reason);
    if (!res.ok) {
      showToast(res.error || 'Unable to cancel order.', 'error');
      return res;
    }
    const [refreshedOrders, refreshedProducts] = await Promise.all([
      databaseService.getCustomerOrders(user.id),
      databaseService.getPublishedProducts(),
    ]);
    if (refreshedOrders.mode === 'live') {
      setOrders(refreshedOrders.data);
    }
    if (refreshedProducts.mode === 'live') {
      setLiveProducts(refreshedProducts.data);
    }
    showToast('Order cancelled and stock restored.');
    return { ok: true };
  };

  const requestOrderRefund = async (params: {
    orderId: string;
    sellerOrderId?: string | null;
    items?: Array<{ order_item_id: string; quantity: number }> | null;
    amountPaise?: number | null;
    reason: string;
  }): Promise<{ ok: boolean; refundId?: string; error?: string }> => {
    if (!isLiveMode) {
      const target = orders.find((o) => o.id === params.orderId);
      if (!target) return { ok: false, error: 'Order not found.' };
      const demoRefundId = `rfnd-demo-${Date.now()}`;
      const amountPaise =
        params.amountPaise ?? Math.round((target.total_paise ?? target.total * 100));
      setOrders((prev) =>
        prev.map((o) =>
          o.id === params.orderId
            ? {
                ...o,
                refunds: [
                  {
                    refundId: demoRefundId,
                    orderId: o.id,
                    sellerOrderId: params.sellerOrderId ?? null,
                    refundChannel: o.payment_method === 'online' ? 'razorpay' : 'cod_manual',
                    refundType: params.items?.length ? 'partial_item' : 'full',
                    amountPaise,
                    shippingRefundPaise: 0,
                    status: 'pending',
                    requestStatus: 'requested',
                    reason: params.reason,
                    restockStatus: 'not_applicable',
                    createdAt: new Date().toISOString(),
                  },
                  ...(o.refunds || []),
                ],
              }
            : o
        )
      );
      showToast('Refund request submitted (Demo Mode).');
      return { ok: true, refundId: demoRefundId };
    }

    if (!user || user.is_demo) {
      return { ok: false, error: 'Sign in required to request a refund.' };
    }

    const res = await databaseService.requestOrderRefund({
      ...params,
      idempotencyKey: `cust-req:${params.orderId}:${Date.now()}`,
    });
    if (res.error) {
      showToast(res.error, 'error');
      return { ok: false, error: res.error };
    }

    const refreshedOrders = await databaseService.getCustomerOrders(user.id);
    if (refreshedOrders.mode === 'live') {
      setOrders(refreshedOrders.data);
    }
    showToast('Refund request submitted.');
    return { ok: true, refundId: res.refundId };
  };

  const refreshLiveState = async () => {
    if (!isLiveMode || !user || user.is_demo) return;
    const [refreshedOrders, refreshedProducts] = await Promise.all([
      databaseService.getCustomerOrders(user.id),
      databaseService.getPublishedProducts(),
    ]);
    if (refreshedOrders.mode === 'live') {
      setOrders(refreshedOrders.data);
    }
    if (refreshedProducts.mode === 'live') {
      setLiveProducts(refreshedProducts.data);
    }
  };

  return (
    <StoreContext.Provider
      value={{
        isLiveMode,
        cart,
        wishlist,
        user,
        orders,
        isSearchOpen,
        setIsSearchOpen,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        cartCount,
        cartSubtotal,
        toggleWishlist,
        isInWishlist,
        wishlistProducts,
        setSessionUser,
        loginDemo,
        logout,
        placeDemoOrder,
        placeLiveOrder,
        cancelOrder,
        requestOrderRefund,
        refreshLiveState,
        toasts,
        showToast,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = (): StoreContextType => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
};
