import React, { useState } from 'react';
import {
  Bell,
  Box,
  IndianRupee,
  LayoutDashboard,
  Menu,
  Package,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import {
  DEMO_NOTIFICATIONS,
  DEMO_SELLER_ORDERS,
  DEMO_SELLER_PRODUCTS,
  DEMO_STORE_PROFILE,
  SellerNotification,
  SellerOrderRecord,
  SellerOrderStatus,
  SellerProductDraft,
  SellerProductionMethod,
  SellerStoreProfile,
  sellerService,
} from '../../services/sellerService';
import { formatINR } from '../../utils/format';
import { useStore } from '../../context/StoreContext';
import { COMMUNITIES } from '../../data/mockData';

type DashboardTab =
  | 'overview'
  | 'store'
  | 'products'
  | 'inventory'
  | 'orders'
  | 'earnings'
  | 'notifications';

export const SellerDashboardPage: React.FC = () => {
  const { showToast } = useStore();
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [storeProfile, setStoreProfile] = useState<SellerStoreProfile>(DEMO_STORE_PROFILE);
  const [products, setProducts] = useState<SellerProductDraft[]>(DEMO_SELLER_PRODUCTS);
  const [orders, setOrders] = useState<SellerOrderRecord[]>(DEMO_SELLER_ORDERS);
  const [notifications, setNotifications] = useState<SellerNotification[]>(DEMO_NOTIFICATIONS);

  // New/Edit product form state
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    community: 'Assamese',
    category: 'Mekhela Sador',
    material: '',
    productionMethod: 'handwoven' as SellerProductionMethod,
    fulfilmentType: 'ready-to-ship' as 'ready-to-ship' | 'made-to-order',
    price: '',
    stockQuantity: '1',
    sizes: 'Free Size',
    colours: '',
    dispatchEstimate: '3-5 business days',
  });

  const isLive = sellerService.isLive();

  // Metrics
  const totalProducts = products.length;
  const publishedCount = products.filter((p) => p.status === 'published').length;
  const pendingCount = products.filter((p) => p.status === 'pending_review').length;
  const rejectedCount = products.filter((p) => p.status === 'rejected').length;
  const lowStockCount = products.filter((p) => p.stockQuantity > 0 && p.stockQuantity <= 3).length;
  const totalOrders = orders.length;
  const pendingOrders = orders.filter((o) => o.status === 'new' || o.status === 'processing').length;
  const grossSales = orders.reduce((sum, o) => sum + o.amount, 0);
  const commissionRate = 0.12;
  const estimatedEarnings = Math.round(grossSales * (1 - commissionRate));
  const unreadNotifications = notifications.filter((n) => !n.read).length;

  const navItems: { id: DashboardTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'store', label: 'Store Profile', icon: <Store className="w-4 h-4" /> },
    { id: 'products', label: 'Products', icon: <Package className="w-4 h-4" /> },
    { id: 'inventory', label: 'Inventory', icon: <Box className="w-4 h-4" /> },
    { id: 'orders', label: 'Orders', icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'earnings', label: 'Earnings', icon: <IndianRupee className="w-4 h-4" /> },
    { id: 'notifications', label: `Notifications (${unreadNotifications})`, icon: <Bell className="w-4 h-4" /> },
  ];

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    showToast(isLive ? 'Store profile updated.' : 'Store profile updated (Demo Mode).');
  };

  const openNewProduct = () => {
    setEditingProductId(null);
    setProductForm({
      name: '',
      description: '',
      community: 'Assamese',
      category: 'Mekhela Sador',
      material: '',
      productionMethod: 'handwoven',
      fulfilmentType: 'ready-to-ship',
      price: '',
      stockQuantity: '1',
      sizes: 'Free Size',
      colours: '',
      dispatchEstimate: '3-5 business days',
    });
    setShowProductForm(true);
  };

  const handleSaveProduct = (submitForReview: boolean) => {
    if (!productForm.name.trim() || !productForm.price || !productForm.material.trim()) {
      showToast('Please fill in product name, material, and price.', 'error');
      return;
    }
    const newStatus = submitForReview ? 'pending_review' : 'draft';
    if (editingProductId) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === editingProductId
            ? {
                ...p,
                ...productForm,
                price: Number(productForm.price),
                stockQuantity: Number(productForm.stockQuantity),
                status: newStatus,
                updatedAt: new Date().toISOString(),
              }
            : p
        )
      );
      showToast(submitForReview ? 'Submitted for NOHAJ admin review.' : 'Draft updated.');
    } else {
      const created: SellerProductDraft = {
        id: `sp-${Date.now()}`,
        ...productForm,
        price: Number(productForm.price),
        stockQuantity: Number(productForm.stockQuantity),
        images: [],
        status: newStatus,
        updatedAt: new Date().toISOString(),
      };
      setProducts((prev) => [created, ...prev]);
      showToast(submitForReview ? 'Product submitted for NOHAJ admin review.' : 'Product saved as draft.');
    }
    setShowProductForm(false);
  };

  const handleStockUpdate = (id: string, newQty: number) => {
    if (newQty < 0) return;
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, stockQuantity: newQty } : p))
    );
    showToast('Stock updated.');
  };

  const handleOrderStatus = (id: string, status: SellerOrderStatus, courier?: string, trackingNumber?: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status, ...(courier ? { courier } : {}), ...(trackingNumber ? { trackingNumber } : {}) }
          : o
      )
    );
    showToast(`Order updated to ${status.replace(/_/g, ' ')}.`);
  };

  return (
    <div className="min-h-[80vh] bg-[#F2EDE4] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#FAF9F6] border-r border-[#D8CBB9] p-6 shrink-0">
        <div className="pb-6 border-b border-[#D8CBB9]">
          <p className="text-[11px] uppercase tracking-widest text-[#777168]">Seller Workspace</p>
          <p className="font-serif text-lg text-[#25231F] mt-1 truncate">{storeProfile.storeName}</p>
          <p className="text-xs text-[#78816A] mt-1">Account: {storeProfile.accountStatus}</p>
        </div>

        <nav className="mt-6 space-y-1.5 flex-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors text-left ${
                activeTab === item.id
                  ? 'bg-[#25231F] text-[#FAF9F6]'
                  : 'text-[#514B43] hover:bg-[#E6DED2] hover:text-[#25231F]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="pt-4 border-t border-[#D8CBB9] text-[11px] text-[#777168]">
          {isLive ? 'Connected to Supabase' : 'Demo Mode · Sample Data'}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="bg-[#FAF9F6] border-b border-[#D8CBB9] px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-[#25231F]"
              aria-label="Open seller menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-serif text-xl sm:text-2xl text-[#25231F] capitalize">
                {activeTab === 'store' ? 'Store Profile' : activeTab}
              </h1>
              {!isLive && (
                <p className="text-[11px] uppercase tracking-wider text-[#A65F46]">
                  Demonstration Data — Connect Supabase for Live Persistence
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className="relative p-2 border border-[#D8CBB9] bg-[#F2EDE4] text-[#25231F]"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#A65F46] text-[#FAF9F6] text-[10px] flex items-center justify-center tabular-nums">
                {unreadNotifications}
              </span>
            )}
          </button>
        </header>

        {/* Mobile Drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div className="fixed inset-0 bg-[#25231F]/40" onClick={() => setMobileNavOpen(false)} />
            <div className="relative w-72 bg-[#FAF9F6] h-full p-6 z-10 flex flex-col">
              <div className="flex items-center justify-between pb-4 border-b border-[#D8CBB9]">
                <span className="font-serif text-lg text-[#25231F]">Seller Menu</span>
                <button type="button" onClick={() => setMobileNavOpen(false)}>
                  <X className="w-5 h-5 text-[#25231F]" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${
                      activeTab === item.id ? 'bg-[#25231F] text-[#FAF9F6]' : 'text-[#514B43]'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <div className="p-4 sm:p-8 max-w-6xl w-full space-y-8">
          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Products', value: totalProducts },
                  { label: 'Published', value: publishedCount },
                  { label: 'Pending Approval', value: pendingCount },
                  { label: 'Rejected', value: rejectedCount },
                  { label: 'Total Orders', value: totalOrders },
                  { label: 'Pending Orders', value: pendingOrders },
                  { label: 'Low Stock Alerts', value: lowStockCount },
                  { label: 'Gross Sales (Demo)', value: formatINR(grossSales) },
                  { label: 'Est. Earnings (Demo)', value: formatINR(estimatedEarnings) },
                ].map((stat) => (
                  <div key={stat.label} className="p-5 bg-[#FAF9F6] border border-[#D8CBB9]">
                    <p className="text-[11px] uppercase tracking-wider text-[#777168]">{stat.label}</p>
                    <p className="font-serif text-2xl text-[#25231F] mt-2 tabular-nums">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-serif text-xl text-[#25231F]">Payout Eligibility</h2>
                  <p className="text-sm text-[#514B43] mt-1">
                    Account Status: <strong>{storeProfile.accountStatus}</strong> · Payout Verification:{' '}
                    <strong className="text-[#A65F46]">{storeProfile.payoutVerificationStatus}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('products')}
                  className="px-6 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest shrink-0"
                >
                  Manage Products
                </button>
              </div>
            </div>
          )}

          {/* STORE PROFILE */}
          {activeTab === 'store' && (
            <form onSubmit={handleSaveStore} className="bg-[#FAF9F6] border border-[#D8CBB9] p-6 sm:p-8 space-y-5 max-w-3xl">
              <h2 className="font-serif text-2xl text-[#25231F]">Store Profile</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1">Store Name</label>
                  <input
                    type="text"
                    value={storeProfile.storeName}
                    onChange={(e) => setStoreProfile({ ...storeProfile, storeName: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={storeProfile.ownerName}
                    onChange={(e) => setStoreProfile({ ...storeProfile, ownerName: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1">Phone</label>
                  <input
                    type="text"
                    value={storeProfile.phone}
                    onChange={(e) => setStoreProfile({ ...storeProfile, phone: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1">Location</label>
                  <input
                    type="text"
                    value={storeProfile.location}
                    onChange={(e) => setStoreProfile({ ...storeProfile, location: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1">Store Description</label>
                <textarea
                  rows={3}
                  value={storeProfile.description}
                  onChange={(e) => setStoreProfile({ ...storeProfile, description: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                />
              </div>
              <button
                type="submit"
                className="px-7 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46]"
              >
                Save Store Profile
              </button>
            </form>
          )}

          {/* PRODUCTS */}
          {activeTab === 'products' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <p className="text-sm text-[#514B43]">
                  New products require NOHAJ admin approval before public publication.
                </p>
                <button
                  type="button"
                  onClick={openNewProduct}
                  className="px-5 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
                >
                  + Add Product
                </button>
              </div>

              {showProductForm && (
                <div className="bg-[#FAF9F6] border border-[#D8CBB9] p-6 space-y-4">
                  <h3 className="font-serif text-xl text-[#25231F]">
                    {editingProductId ? 'Edit Product' : 'New Product Submission'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <input
                      type="text"
                      placeholder="Product Name *"
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                      className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                    />
                    <select
                      value={productForm.community}
                      onChange={(e) => setProductForm({ ...productForm, community: e.target.value })}
                      className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                    >
                      {COMMUNITIES.map((c) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Material (e.g. Muga Silk) *"
                      value={productForm.material}
                      onChange={(e) => setProductForm({ ...productForm, material: e.target.value })}
                      className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                    />
                    <select
                      value={productForm.productionMethod}
                      onChange={(e) =>
                        setProductForm({ ...productForm, productionMethod: e.target.value as SellerProductionMethod })
                      }
                      className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                    >
                      <option value="handwoven">Handwoven</option>
                      <option value="handmade">Handmade</option>
                      <option value="machine-made">Machine-made</option>
                      <option value="sourced">Sourced</option>
                    </select>
                    <input
                      type="number"
                      placeholder="Price (INR) *"
                      value={productForm.price}
                      onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                      className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Stock Quantity"
                      value={productForm.stockQuantity}
                      onChange={(e) => setProductForm({ ...productForm, stockQuantity: e.target.value })}
                      className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                    />
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Product Description"
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handleSaveProduct(false)}
                      className="px-5 py-2.5 border border-[#25231F] text-xs uppercase tracking-widest text-[#25231F]"
                    >
                      Save Draft
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveProduct(true)}
                      className="px-5 py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest"
                    >
                      Submit for Admin Review
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowProductForm(false)}
                      className="px-4 py-2.5 text-xs uppercase tracking-widest text-[#777168]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {products.map((p) => (
                  <div key={p.id} className="p-5 bg-[#FAF9F6] border border-[#D8CBB9] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-[#777168]">
                        {p.community} · {p.material} · {p.productionMethod}
                      </p>
                      <h3 className="font-serif text-lg text-[#25231F]">{p.name}</h3>
                      <p className="text-xs text-[#514B43] mt-1 tabular-nums">
                        {formatINR(p.price)} · Stock: {p.stockQuantity}
                      </p>
                      {p.rejectionReason && (
                        <p className="text-xs text-[#A65F46] mt-1.5">
                          Admin Feedback: {p.rejectionReason}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs uppercase tracking-wider px-2.5 py-1 border border-[#D8CBB9] bg-[#F2EDE4] text-[#25231F]">
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* INVENTORY */}
          {activeTab === 'inventory' && (
            <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
              {products.map((p) => (
                <div key={p.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-serif text-lg text-[#25231F]">{p.name}</h3>
                    <p className="text-xs text-[#777168]">
                      {p.stockQuantity === 0 ? (
                        <span className="text-[#A65F46]">Out of Stock</span>
                      ) : p.stockQuantity <= 3 ? (
                        <span className="text-[#A65F46]">Low Stock ({p.stockQuantity} left)</span>
                      ) : (
                        <span>In Stock ({p.stockQuantity} units)</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleStockUpdate(p.id, p.stockQuantity - 1)}
                      className="px-3 py-1.5 border border-[#D8CBB9] text-sm"
                    >
                      -
                    </button>
                    <span className="w-10 text-center text-sm tabular-nums">{p.stockQuantity}</span>
                    <button
                      type="button"
                      onClick={() => handleStockUpdate(p.id, p.stockQuantity + 1)}
                      className="px-3 py-1.5 border border-[#D8CBB9] text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ORDERS */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              {orders.map((o) => (
                <div key={o.id} className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3">
                  <div className="flex flex-wrap justify-between gap-2 pb-3 border-b border-[#E6DED2]">
                    <div>
                      <span className="font-medium text-sm text-[#25231F] tabular-nums">{o.orderNumber}</span>
                      <span className="ml-3 text-xs text-[#777168]">{o.deliveryCity}</span>
                    </div>
                    <span className="text-xs uppercase tracking-wider text-[#A65F46]">
                      {o.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-[#514B43]">
                    {o.productName} × {o.quantity} · <strong className="tabular-nums">{formatINR(o.amount)}</strong> ({o.paymentMethod})
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {o.status === 'new' && (
                      <button
                        type="button"
                        onClick={() => handleOrderStatus(o.id, 'confirmed')}
                        className="px-4 py-2 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider"
                      >
                        Accept Order
                      </button>
                    )}
                    {(o.status === 'confirmed' || o.status === 'processing') && (
                      <button
                        type="button"
                        onClick={() => handleOrderStatus(o.id, 'dispatched', 'India Post', 'IND-992817')}
                        className="px-4 py-2 border border-[#25231F] text-[#25231F] text-xs uppercase tracking-wider"
                      >
                        Mark Dispatched
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* EARNINGS */}
          {activeTab === 'earnings' && (
            <div className="bg-[#FAF9F6] border border-[#D8CBB9] p-6 sm:p-8 space-y-4 max-w-2xl">
              <h2 className="font-serif text-2xl text-[#25231F]">Earnings & Settlements (Demo)</h2>
              <p className="text-xs text-[#A65F46] uppercase tracking-wider">
                Estimates shown below — live payouts require separate verification.
              </p>
              <div className="space-y-3 pt-2 text-sm border-t border-[#E6DED2]">
                <div className="flex justify-between">
                  <span className="text-[#514B43]">Gross Product Sales</span>
                  <span className="tabular-nums font-medium">{formatINR(grossSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#514B43]">Marketplace Commission (12%)</span>
                  <span className="tabular-nums text-[#A65F46]">-{formatINR(Math.round(grossSales * commissionRate))}</span>
                </div>
                <div className="flex justify-between pt-3 border-t border-[#D8CBB9] font-medium text-base text-[#25231F]">
                  <span>Estimated Seller Earnings</span>
                  <span className="tabular-nums">{formatINR(estimatedEarnings)}</span>
                </div>
                <div className="flex justify-between text-xs text-[#777168]">
                  <span>Recorded Settlements</span>
                  <span className="tabular-nums">{formatINR(0)}</span>
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className="space-y-3">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() =>
                    setNotifications((prev) =>
                      prev.map((item) => (item.id === n.id ? { ...item, read: true } : item))
                    )
                  }
                  className={`p-5 border cursor-pointer ${
                    n.read ? 'bg-[#FAF9F6] border-[#D8CBB9]' : 'bg-[#FAF9F6] border-[#A65F46]'
                  }`}
                >
                  <div className="flex justify-between gap-4">
                    <h3 className="font-serif text-base text-[#25231F]">{n.title}</h3>
                    {!n.read && <span className="text-[10px] uppercase tracking-widest text-[#A65F46]">Unread</span>}
                  </div>
                  <p className="text-sm text-[#514B43] mt-1">{n.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
