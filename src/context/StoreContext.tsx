import React, { createContext, useContext, useEffect, useState } from 'react';
import { CartItem, CustomerUser, Order, Product } from '../types';
import { PRODUCTS } from '../data/mockData';

interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'info' | 'error';
}

interface StoreContextType {
  cart: CartItem[];
  wishlist: string[];
  user: CustomerUser | null;
  orders: Order[];
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  addToCart: (product: Product, quantity?: number, size?: string, colour?: string) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartSubtotal: number;
  toggleWishlist: (productId: string) => void;
  isInWishlist: (productId: string) => boolean;
  wishlistProducts: Product[];
  loginDemo: (email: string, name?: string) => void;
  logoutDemo: () => void;
  placeDemoOrder: (customerName: string, customerEmail: string, shippingAddress: string) => Order;
  toasts: ToastMessage[];
  showToast: (text: string, type?: 'success' | 'info' | 'error') => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const CART_KEY = 'nohaj_demo_cart';
const WISHLIST_KEY = 'nohaj_demo_wishlist';
const USER_KEY = 'nohaj_demo_user';
const ORDERS_KEY = 'nohaj_demo_orders';

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [wishlist, setWishlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(WISHLIST_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [user, setUser] = useState<CustomerUser | null>(() => {
    try {
      const saved = localStorage.getItem(USER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      const saved = localStorage.getItem(ORDERS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
  }, [wishlist]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  }, [orders]);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  const addToCart = (product: Product, quantity = 1, size?: string, colour?: string) => {
    const selectedSize = size || product.sizes[0] || 'Free Size';
    const selectedColour = colour || product.colours[0] || 'Natural';
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { product, quantity, selectedSize, selectedColour }];
    });
    showToast(`${product.name} added to your bag.`);
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
    showToast('Item removed from bag.', 'info');
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    );
  };

  const clearCart = () => setCart([]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  const toggleWishlist = (productId: string) => {
    setWishlist((prev) => {
      const exists = prev.includes(productId);
      if (exists) {
        showToast('Removed from wishlist.', 'info');
        return prev.filter((id) => id !== productId);
      }
      showToast('Saved to wishlist.');
      return [...prev, productId];
    });
  };

  const isInWishlist = (productId: string) => wishlist.includes(productId);

  const wishlistProducts = PRODUCTS.filter((p) => wishlist.includes(p.id));

  const loginDemo = (email: string, name = 'Guest Patron') => {
    const demoUser: CustomerUser = {
      id: 'demo-user-1',
      name,
      email,
      saved_addresses: ['Guwahati, Assam 781001'],
      is_demo: true,
    };
    setUser(demoUser);
    showToast(`Signed in as ${name} (Demo Mode).`);
  };

  const logoutDemo = () => {
    setUser(null);
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
      customer_id: user?.id || 'guest-demo',
      customer_name: customerName,
      customer_email: customerEmail,
      shipping_address: shippingAddress,
      total: cartSubtotal + shippingAmount,
      shipping_amount: shippingAmount,
      status: 'Confirmed (Demo)',
      payment_status: 'Demo Checkout',
      items: cart.map((item, idx) => ({
        id: `oi-${idx}-${Date.now()}`,
        order_id: '',
        product_id: item.product.id,
        product_name: item.product.name,
        seller_id: item.product.seller_id,
        quantity: item.quantity,
        unit_price: item.product.price,
      })),
      created_at: new Date().toISOString(),
    };
    setOrders((prev) => [newOrder, ...prev]);
    clearCart();
    return newOrder;
  };

  return (
    <StoreContext.Provider
      value={{
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
        loginDemo,
        logoutDemo,
        placeDemoOrder,
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
