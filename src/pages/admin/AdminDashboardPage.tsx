import React, { useState } from 'react';
import {
  CheckSquare,
  FileText,
  Globe,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Settings,
  Shield,
  ShoppingBag,
  Store,
  Users,
  X,
} from 'lucide-react';
import {
  AdminAuditLog,
  AdminOrderRecord,
  AdminProductSubmission,
  AdminSellerRecord,
  AdminTab,
  DEMO_ADMIN_ORDERS,
  DEMO_ADMIN_SELLERS,
  DEMO_ADMIN_SUBMISSIONS,
  MarketplaceSettings,
  adminService,
  canAccessAdminTab,
} from '../../services/adminService';
import { UserRole } from '../../services/auth';
import { COMMUNITIES } from '../../data/mockData';
import { formatINR } from '../../utils/format';
import { useStore } from '../../context/StoreContext';

export const AdminDashboardPage: React.FC = () => {
  const { showToast } = useStore();
  const [adminRole, setAdminRole] = useState<UserRole>('super_admin');
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [sellers, setSellers] = useState<AdminSellerRecord[]>(DEMO_ADMIN_SELLERS);
  const [submissions, setSubmissions] = useState<AdminProductSubmission[]>(DEMO_ADMIN_SUBMISSIONS);
  const [orders] = useState<AdminOrderRecord[]>(DEMO_ADMIN_ORDERS);
  const [settings, setSettings] = useState<MarketplaceSettings>({
    commissionRate: 12,
    codEnabled: true,
    freeShippingThreshold: 5000,
    returnWindowDays: 7,
  });
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([
    {
      id: 'log-1',
      actorRole: 'super_admin',
      action: 'INITIALIZE_MARKETPLACE',
      target: 'marketplace_settings',
      details: 'Default commission set to 12% (Demo Mode)',
      createdAt: new Date().toISOString(),
    },
  ]);

  const [rejectFeedback, setRejectFeedback] = useState<Record<string, string>>({});
  const [sellerSearch, setSellerSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');

  const isLive = adminService.isLive();

  const recordAudit = (action: string, target: string, details: string) => {
    setAuditLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        actorRole: adminRole,
        action,
        target,
        details,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const navItems: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'sellers', label: 'Sellers', icon: <Store className="w-4 h-4" /> },
    { id: 'moderation', label: 'Product Moderation', icon: <CheckSquare className="w-4 h-4" /> },
    { id: 'orders', label: 'Orders', icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'customers', label: 'Customers', icon: <Users className="w-4 h-4" /> },
    { id: 'communities', label: 'Communities', icon: <Globe className="w-4 h-4" /> },
    { id: 'returns', label: 'Reviews & Returns', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'content', label: 'Content', icon: <FileText className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
    { id: 'audit', label: 'Audit Logs', icon: <Shield className="w-4 h-4" /> },
  ];

  const visibleNav = navItems.filter((item) => canAccessAdminTab(adminRole, item.id));

  const gmv = orders.reduce((s, o) => s + o.total, 0);
  const commissionRevenue = Math.round(gmv * (settings.commissionRate / 100));

  const handleSellerStatus = (id: string, accountStatus: 'active' | 'suspended') => {
    setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, accountStatus } : s)));
    recordAudit('UPDATE_SELLER_STATUS', id, `Set accountStatus to ${accountStatus}`);
    showToast(`Seller ${accountStatus}.`);
  };

  const handleSellerPayout = (id: string, payoutVerification: 'verified' | 'pending' | 'unverified') => {
    setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, payoutVerification } : s)));
    recordAudit('UPDATE_PAYOUT_VERIFICATION', id, `Set payoutVerification to ${payoutVerification}`);
    showToast(`Payout verification set to ${payoutVerification}.`);
  };

  const handleModerateProduct = (
    id: string,
    status: AdminProductSubmission['status']
  ) => {
    if (status === 'rejected' && !rejectFeedback[id]?.trim()) {
      showToast('Please enter mandatory rejection feedback.', 'error');
      return;
    }
    setSubmissions((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status, feedback: rejectFeedback[id] || p.feedback } : p
      )
    );
    recordAudit('MODERATE_PRODUCT', id, `Changed product status to ${status}`);
    showToast(`Product marked as ${status.replace(/_/g, ' ')}.`);
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    recordAudit(
      'UPDATE_MARKETPLACE_SETTINGS',
      'marketplace_settings',
      `Commission: ${settings.commissionRate}%, COD: ${settings.codEnabled}`
    );
    showToast('Marketplace settings saved & recorded in audit_logs.');
  };

  return (
    <div className="min-h-[82vh] bg-[#F2EDE4] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#25231F] text-[#E6DED2] p-6 shrink-0">
        <div className="pb-6 border-b border-[#3A3630]">
          <p className="text-[11px] uppercase tracking-widest text-[#D8CBB9]">NOHAJ Control</p>
          <p className="font-serif text-xl text-[#FAF9F6] mt-1">Admin Console</p>
          <div className="mt-3">
            <label className="block text-[10px] uppercase tracking-wider text-[#777168] mb-1">
              Preview Role
            </label>
            <select
              value={adminRole}
              onChange={(e) => {
                const nextRole = e.target.value as UserRole;
                setAdminRole(nextRole);
                setActiveTab('overview');
              }}
              className="w-full px-2.5 py-1.5 bg-[#3A3630] border border-[#514B43] text-xs text-[#FAF9F6]"
            >
              <option value="super_admin">Super Admin</option>
              <option value="operations_admin">Operations Admin</option>
              <option value="content_admin">Content Admin</option>
            </select>
          </div>
        </div>

        <nav className="mt-6 space-y-1 flex-1">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors text-left ${
                activeTab === item.id
                  ? 'bg-[#A65F46] text-[#FAF9F6]'
                  : 'text-[#D8CBB9] hover:bg-[#3A3630] hover:text-[#FAF9F6]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="pt-4 border-t border-[#3A3630] text-[11px] text-[#777168]">
          {isLive ? 'Live Supabase Connected' : 'Demo Mode · Sample Data'}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-[#FAF9F6] border-b border-[#D8CBB9] px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-[#25231F]"
              aria-label="Open admin menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-serif text-xl sm:text-2xl text-[#25231F] capitalize">
                {activeTab === 'moderation' ? 'Product Moderation' : activeTab}
              </h1>
              <p className="text-[11px] uppercase tracking-wider text-[#777168]">
                Role: {adminRole.replace(/_/g, ' ')} · {!isLive ? 'Demo Mode' : 'Live'}
              </p>
            </div>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div className="fixed inset-0 bg-[#25231F]/40" onClick={() => setMobileNavOpen(false)} />
            <div className="relative w-72 bg-[#25231F] text-[#FAF9F6] h-full p-6 z-10 flex flex-col">
              <div className="flex items-center justify-between pb-4 border-b border-[#3A3630]">
                <span className="font-serif text-lg">Admin Menu</span>
                <button type="button" onClick={() => setMobileNavOpen(false)}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {visibleNav.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${
                      activeTab === item.id ? 'bg-[#A65F46] text-[#FAF9F6]' : 'text-[#D8CBB9]'
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

        <div className="p-4 sm:p-8 max-w-6xl w-full space-y-8">
          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {[
                { label: 'Registered Customers', value: 2 },
                { label: 'Total Sellers', value: sellers.length },
                { label: 'Active Sellers', value: sellers.filter((s) => s.accountStatus === 'active').length },
                { label: 'Pending Payout Verif.', value: sellers.filter((s) => s.payoutVerification === 'pending').length },
                { label: 'Total Products', value: submissions.length },
                { label: 'Published Products', value: submissions.filter((p) => p.status === 'published').length },
                { label: 'Pending Approvals', value: submissions.filter((p) => p.status === 'pending_review').length },
                { label: 'Total Orders', value: orders.length },
                { label: 'GMV (Demo)', value: formatINR(gmv) },
                { label: `Commission (${settings.commissionRate}%)`, value: formatINR(commissionRevenue) },
              ].map((stat) => (
                <div key={stat.label} className="p-5 bg-[#FAF9F6] border border-[#D8CBB9]">
                  <p className="text-[11px] uppercase tracking-wider text-[#777168]">{stat.label}</p>
                  <p className="font-serif text-2xl text-[#25231F] mt-2 tabular-nums">{stat.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* SELLERS */}
          {activeTab === 'sellers' && (
            <div className="space-y-4">
              <input
                type="text"
                value={sellerSearch}
                onChange={(e) => setSellerSearch(e.target.value)}
                placeholder="Search sellers by name or location..."
                className="w-full max-w-md px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm"
              />
              <div className="space-y-3">
                {sellers
                  .filter((s) => s.businessName.toLowerCase().includes(sellerSearch.toLowerCase()))
                  .map((s) => (
                    <div key={s.id} className="p-5 bg-[#FAF9F6] border border-[#D8CBB9] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="font-serif text-lg text-[#25231F]">{s.businessName}</h3>
                        <p className="text-xs text-[#777168]">
                          {s.ownerName} · {s.location} · Account: <strong>{s.accountStatus}</strong> · Payout: <strong>{s.payoutVerification}</strong>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleSellerPayout(s.id, 'verified')}
                          className="px-3 py-1.5 bg-[#78816A] text-[#FAF9F6] text-xs uppercase tracking-wider"
                        >
                          Verify Payout
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleSellerStatus(s.id, s.accountStatus === 'active' ? 'suspended' : 'active')
                          }
                          className="px-3 py-1.5 border border-[#25231F] text-xs uppercase tracking-wider text-[#25231F]"
                        >
                          {s.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* PRODUCT MODERATION */}
          {activeTab === 'moderation' && (
            <div className="space-y-4">
              {submissions.map((p) => (
                <div key={p.id} className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] flex flex-col md:flex-row gap-6">
                  <img src={p.image} alt={p.name} className="w-24 aspect-[3/4] object-cover border border-[#D8CBB9] shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="font-serif text-xl text-[#25231F]">{p.name}</h3>
                      <span className="text-xs uppercase tracking-wider px-2.5 py-1 bg-[#F2EDE4] border border-[#D8CBB9]">
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-[#777168]">
                      Seller: {p.sellerName} · {p.community} · {p.material} · {p.productionMethod} · {formatINR(p.price)}
                    </p>
                    <div className="pt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleModerateProduct(p.id, 'published')}
                        className="px-4 py-2 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider"
                      >
                        Approve & Publish
                      </button>
                      <button
                        type="button"
                        onClick={() => handleModerateProduct(p.id, 'suspended')}
                        className="px-4 py-2 border border-[#25231F] text-xs uppercase tracking-wider"
                      >
                        Suspend
                      </button>
                      <input
                        type="text"
                        placeholder="Mandatory feedback for rejection..."
                        value={rejectFeedback[p.id] || ''}
                        onChange={(e) => setRejectFeedback({ ...rejectFeedback, [p.id]: e.target.value })}
                        className="px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs flex-1 min-w-[200px]"
                      />
                      <button
                        type="button"
                        onClick={() => handleModerateProduct(p.id, 'rejected')}
                        className="px-4 py-2 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-wider"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ORDERS */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              <input
                type="text"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Search by Order ID (e.g. NHJ-402819)..."
                className="w-full max-w-md px-3.5 py-2.5 bg-[#FAF9F6] border border-[#D8CBB9] text-sm"
              />
              {orders
                .filter((o) => o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()))
                .map((o) => (
                  <div key={o.id} className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium text-sm tabular-nums text-[#25231F]">{o.orderNumber}</span>
                      <span className="text-xs uppercase tracking-wider text-[#78816A]">
                        {o.paymentMethod} · {o.paymentStatus}
                      </span>
                      <span className="font-medium text-sm tabular-nums">{formatINR(o.total)}</span>
                    </div>
                    <p className="text-xs text-[#777168]">Customer: {o.customerName}</p>
                    <div className="pt-2 border-t border-[#E6DED2] text-xs text-[#514B43]">
                      {o.sellerOrders.map((so, i) => (
                        <p key={i}>
                          Seller Fulfilment: <strong>{so.sellerName}</strong> — {so.fulfilmentStatus} ({formatINR(so.subtotal)})
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* CUSTOMERS */}
          {activeTab === 'customers' && (
            <div className="bg-[#FAF9F6] border border-[#D8CBB9] p-6 space-y-3">
              <h2 className="font-serif text-xl text-[#25231F]">Registered Customers (Demo)</h2>
              <p className="text-sm text-[#514B43]">Ananya Baruah · ananya@example.com · 1 Order · Active</p>
              <p className="text-sm text-[#514B43]">Rohan Kalita · rohan@example.com · 1 Order · Active</p>
            </div>
          )}

          {/* COMMUNITIES */}
          {activeTab === 'communities' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {COMMUNITIES.map((c) => (
                <div key={c.id} className="p-5 bg-[#FAF9F6] border border-[#D8CBB9]">
                  <p className="text-[11px] uppercase tracking-wider text-[#777168]">{c.state}</p>
                  <h3 className="font-serif text-xl text-[#25231F] mt-1">{c.name}</h3>
                  <p className="text-xs text-[#514B43] mt-2 line-clamp-3">{c.description}</p>
                </div>
              ))}
            </div>
          )}

          {/* RETURNS */}
          {activeTab === 'returns' && (
            <div className="bg-[#FAF9F6] border border-[#D8CBB9] p-6">
              <h2 className="font-serif text-xl text-[#25231F]">Reviews, Returns & Disputes</h2>
              <p className="text-sm text-[#777168] mt-2">No active return requests or reported reviews in Demo Mode.</p>
            </div>
          )}

          {/* CONTENT */}
          {activeTab === 'content' && (
            <div className="bg-[#FAF9F6] border border-[#D8CBB9] p-6 space-y-3">
              <h2 className="font-serif text-xl text-[#25231F]">Storefront Content Management</h2>
              <p className="text-sm text-[#514B43]">
                Announcement Bar: <strong>Discover the heritage of Northeast India.</strong>
              </p>
              <p className="text-sm text-[#514B43]">
                Hero Headline: <strong>Tradition deserves a wider world.</strong>
              </p>
            </div>
          )}

          {/* SETTINGS (Super Admin Only) */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="bg-[#FAF9F6] border border-[#D8CBB9] p-6 sm:p-8 space-y-5 max-w-xl">
              <h2 className="font-serif text-2xl text-[#25231F]">Marketplace Settings</h2>
              <div>
                <label className="block text-xs uppercase tracking-wider text-[#777168] mb-1.5">
                  Marketplace Commission Rate (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={settings.commissionRate}
                  onChange={(e) => setSettings({ ...settings, commissionRate: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm tabular-nums"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="cod-toggle"
                  type="checkbox"
                  checked={settings.codEnabled}
                  onChange={(e) => setSettings({ ...settings, codEnabled: e.target.checked })}
                  className="accent-[#A65F46]"
                />
                <label htmlFor="cod-toggle" className="text-sm text-[#25231F]">
                  Enable Cash on Delivery (COD)
                </label>
              </div>
              <button
                type="submit"
                className="px-7 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46]"
              >
                Save Settings
              </button>
            </form>
          )}

          {/* AUDIT LOGS (Super Admin Only) */}
          {activeTab === 'audit' && (
            <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-4 text-xs flex flex-wrap justify-between gap-2">
                  <div>
                    <span className="font-medium text-[#25231F]">{log.action}</span>
                    <span className="ml-2 text-[#777168]">by {log.actorRole}</span>
                    <p className="text-[#514B43] mt-0.5">{log.details}</p>
                  </div>
                  <span className="text-[#777168] tabular-nums">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
