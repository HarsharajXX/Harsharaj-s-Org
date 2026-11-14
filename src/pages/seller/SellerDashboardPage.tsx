import React, { useEffect, useState } from 'react';
import {
  Bell,
  Box,
  IndianRupee,
  Landmark,
  LayoutDashboard,
  Menu,
  Package,
  RotateCcw,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import {
  DEMO_NOTIFICATIONS,
  DEMO_SELLER_LEDGER,
  DEMO_SELLER_ORDERS,
  DEMO_SELLER_PRODUCTS,
  DEMO_SELLER_REFUNDS,
  DEMO_SELLER_SETTLEMENT_ACCOUNT,
  DEMO_SELLER_SETTLEMENT_RECORDS,
  DEMO_SELLER_SETTLEMENT_SUMMARY,
  DEMO_SELLER_TRANSFERS,
  DEMO_STORE_PROFILE,
  SellerLedgerEntry,
  SellerNotification,
  SellerOrderRecord,
  SellerOrderStatus,
  SellerProductDraft,
  SellerProductionMethod,
  SellerStoreProfile,
  sellerService,
} from '../../services/sellerService';
import { formatInrFromPaise, SellerRefundSummary } from '../../services/payments/paymentTypes';
import type {
  SellerSettlementAccount,
  SellerSettlementPayoutRecord,
  SellerSettlementSummary,
  SellerTransferItem,
} from '../../services/payments/settlementTypes';
import { getRefundStatusLabel } from '../../services/payments/paymentStatus';
import { formatINR } from '../../utils/format';
import { canSellerCancelOrderStatus } from '../../utils/commerceRules';
import { useStore } from '../../context/StoreContext';
import { useCatalogue } from '../../hooks/useCatalogue';
import { OCCASIONS } from '../../data/mockData';
import { CategoryOption, databaseService } from '../../services/database';

type DashboardTab =
  | 'overview'
  | 'store'
  | 'products'
  | 'inventory'
  | 'orders'
  | 'earnings'
  | 'settlements'
  | 'refunds'
  | 'notifications';

export const SellerDashboardPage: React.FC = () => {
  const { user, showToast } = useStore();
  const { communities } = useCatalogue();
  const isLive = sellerService.isLive();

  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loading, setLoading] = useState(isLive);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(isLive ? null : 'demo-seller');
  const [commissionRate, setCommissionRate] = useState<number>(0.12);

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);

  const [storeProfile, setStoreProfile] = useState<SellerStoreProfile>(
    isLive
      ? {
          storeName: 'Loading...',
          ownerName: '',
          email: '',
          phone: '',
          location: '',
          sellerType: 'Artisan',
          categories: '',
          description: '',
          socialLink: '',
          emailVerified: false,
          accountStatus: 'pending_email_verification',
          payoutVerificationStatus: 'unverified',
        }
      : DEMO_STORE_PROFILE
  );
  const [products, setProducts] = useState<SellerProductDraft[]>(
    isLive ? [] : DEMO_SELLER_PRODUCTS
  );
  const [orders, setOrders] = useState<SellerOrderRecord[]>(
    isLive ? [] : DEMO_SELLER_ORDERS
  );
  const [notifications, setNotifications] = useState<SellerNotification[]>(
    isLive ? [] : DEMO_NOTIFICATIONS
  );
  const [refunds, setRefunds] = useState<SellerRefundSummary[]>(
    isLive ? [] : DEMO_SELLER_REFUNDS
  );
  const [ledgerEntries, setLedgerEntries] = useState<SellerLedgerEntry[]>(
    isLive ? [] : DEMO_SELLER_LEDGER
  );
  const [settlementAccount, setSettlementAccount] = useState<SellerSettlementAccount | null>(
    isLive ? null : DEMO_SELLER_SETTLEMENT_ACCOUNT
  );
  const [settlementSummary, setSettlementSummary] = useState<SellerSettlementSummary | null>(
    isLive ? null : DEMO_SELLER_SETTLEMENT_SUMMARY
  );
  const [transfers, setTransfers] = useState<SellerTransferItem[]>(
    isLive ? [] : DEMO_SELLER_TRANSFERS
  );
  const [settlementRecords, setSettlementRecords] = useState<SellerSettlementPayoutRecord[]>(
    isLive ? [] : DEMO_SELLER_SETTLEMENT_RECORDS
  );
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [kycUploading, setKycUploading] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState({
    legalBusinessName: '',
    businessType: 'individual',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    panLast4: '',
    gstin: '',
    beneficiaryName: '',
    bankAccountLast4: '',
    bankIfsc: '',
    street1: '',
    city: '',
    state: 'Assam',
    postalCode: '',
    kycStoragePaths: [] as string[],
    sellerConsentAccepted: false,
    agreementAccepted: false,
  });
  const [inspectingRefundId, setInspectingRefundId] = useState<string | null>(null);
  const [inspectionNotes, setInspectionNotes] = useState<Record<string, string>>({});

  // New/Edit product form state
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    community: 'Assamese',
    category: 'Mekhela Sador',
    occasion: [] as string[],
    material: '',
    productionMethod: 'Handwoven' as SellerProductionMethod,
    fulfilmentType: 'ready-to-ship' as 'ready-to-ship' | 'made-to-order',
    price: '',
    stockQuantity: '1',
    sizes: 'Free Size',
    colours: '',
    dispatchEstimate: '3-5 business days',
  });

  useEffect(() => {
    databaseService.getCategories().then((res) => {
      if (res.data.length > 0) setCategories(res.data);
    });
  }, []);

  useEffect(() => {
    if (!isLive || !user || user.is_demo) return;
    let active = true;
    setLoading(true);
    sellerService.fetchWorkspace(user.id).then((res) => {
      if (!active) return;
      setLoading(false);
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
      setSellerId(res.sellerId);
      if (res.storeProfile) setStoreProfile(res.storeProfile);
      setProducts(res.products);
      setOrders(res.orders);
      setRefunds(res.refunds);
      setLedgerEntries(res.ledgerEntries);
      setNotifications(res.notifications);
      setSettlementAccount(res.settlementAccount);
      setSettlementSummary(res.settlementSummary);
      setTransfers(res.transfers);
      setSettlementRecords(res.settlementRecords);
      if (res.settlementAccount) {
        setOnboardingForm({
          legalBusinessName: res.settlementAccount.legalBusinessName,
          businessType: res.settlementAccount.businessType || 'individual',
          contactName: res.settlementAccount.contactName,
          contactEmail: res.settlementAccount.contactEmail,
          contactPhone: res.settlementAccount.contactPhone,
          panLast4: res.settlementAccount.panLast4,
          gstin: res.settlementAccount.gstin || '',
          beneficiaryName: res.settlementAccount.beneficiaryName,
          bankAccountLast4: res.settlementAccount.bankAccountLast4,
          bankIfsc: res.settlementAccount.bankIfsc,
          street1: res.settlementAccount.registeredAddress?.street1 || '',
          city: res.settlementAccount.registeredAddress?.city || '',
          state: res.settlementAccount.registeredAddress?.state || 'Assam',
          postalCode: res.settlementAccount.registeredAddress?.postal_code || '',
          kycStoragePaths: res.settlementAccount.kycStoragePaths || [],
          sellerConsentAccepted: res.settlementAccount.sellerConsentAccepted,
          agreementAccepted: res.settlementAccount.agreementAccepted,
        });
      } else if (res.storeProfile) {
        setOnboardingForm((prev) => ({
          ...prev,
          legalBusinessName: prev.legalBusinessName || res.storeProfile!.storeName,
          contactName: prev.contactName || res.storeProfile!.ownerName,
          contactEmail: prev.contactEmail || res.storeProfile!.email,
          contactPhone: prev.contactPhone || res.storeProfile!.phone,
          beneficiaryName: prev.beneficiaryName || res.storeProfile!.ownerName,
        }));
      }
      setCommissionRate(res.commissionRate);
    });
    return () => {
      active = false;
    };
  }, [isLive, user]);

  // Metrics
  const totalProducts = products.length;
  const publishedCount = products.filter((p) => p.status === 'published').length;
  const pendingCount = products.filter((p) => p.status === 'pending_review').length;
  const rejectedCount = products.filter((p) => p.status === 'rejected').length;
  const lowStockCount = products.filter((p) => p.stockQuantity > 0 && p.stockQuantity <= 3).length;
  const totalOrders = orders.length;
  const pendingOrders = orders.filter((o) => o.status === 'new' || o.status === 'processing').length;
  const grossSales = orders.reduce((sum, o) => sum + o.amount, 0);
  const estimatedEarnings = Math.round(grossSales * (1 - commissionRate));
  const unreadNotifications = notifications.filter((n) => !n.read).length;

  const navItems: { id: DashboardTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'store', label: 'Store Profile', icon: <Store className="w-4 h-4" /> },
    { id: 'products', label: 'Products', icon: <Package className="w-4 h-4" /> },
    { id: 'inventory', label: 'Inventory', icon: <Box className="w-4 h-4" /> },
    { id: 'orders', label: 'Orders', icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'earnings', label: 'Earnings', icon: <IndianRupee className="w-4 h-4" /> },
    { id: 'settlements', label: 'Settlements & KYC', icon: <Landmark className="w-4 h-4" /> },
    { id: 'refunds', label: 'Refunds & Ledger', icon: <RotateCcw className="w-4 h-4" /> },
    { id: 'notifications', label: `Notifications (${unreadNotifications})`, icon: <Bell className="w-4 h-4" /> },
  ];

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLive && sellerId) {
      const res = await sellerService.updateStoreProfile(sellerId, storeProfile);
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
      showToast('Store profile updated.');
      return;
    }
    showToast('Store profile updated (Demo Mode).');
  };

  const openNewProduct = () => {
    setEditingProductId(null);
    setProductForm({
      name: '',
      description: '',
      community: communities[0]?.name || 'Assamese',
      category: categories[0]?.name || 'Mekhela Sador',
      occasion: [],
      material: '',
      productionMethod: 'Handwoven',
      fulfilmentType: 'ready-to-ship',
      price: '',
      stockQuantity: '1',
      sizes: 'Free Size',
      colours: '',
      dispatchEstimate: '3-5 business days',
    });
    setShowProductForm(true);
  };

  const toggleOccasion = (label: string) => {
    setProductForm((prev) => ({
      ...prev,
      occasion: prev.occasion.includes(label)
        ? prev.occasion.filter((item) => item !== label)
        : [...prev.occasion, label],
    }));
  };

  const handleSaveProduct = async (submitForReview: boolean) => {
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
      if (isLive && sellerId) {
        const res = await sellerService.createProduct(
          sellerId,
          {
            name: productForm.name.trim(),
            description: productForm.description.trim(),
            communityName: productForm.community,
            categoryName: productForm.category,
            occasion: productForm.occasion,
            material: productForm.material.trim(),
            productionMethod: productForm.productionMethod,
            fulfilmentType: productForm.fulfilmentType,
            price: Number(productForm.price),
            stockQuantity: Number(productForm.stockQuantity),
            dispatchEstimate: productForm.dispatchEstimate,
          },
          submitForReview
        );
        if (res.error || !res.id) {
          showToast(res.error || 'Could not save product.', 'error');
          return;
        }
        const created: SellerProductDraft = {
          id: res.id,
          ...productForm,
          price: Number(productForm.price),
          stockQuantity: Number(productForm.stockQuantity),
          images: [],
          status: newStatus,
          updatedAt: new Date().toISOString(),
        };
        setProducts((prev) => [created, ...prev]);
        showToast(submitForReview ? 'Product submitted for NOHAJ admin review.' : 'Product saved as draft.');
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
    }
    setShowProductForm(false);
  };

  const handleStockUpdate = async (id: string, newQty: number) => {
    if (newQty < 0) return;
    if (isLive) {
      const res = await sellerService.updateStockQuantity(id, newQty);
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, stockQuantity: newQty } : p))
    );
    showToast('Stock updated.');
  };

  const handleOrderStatus = async (
    id: string,
    status: SellerOrderStatus,
    courier?: string,
    trackingNumber?: string
  ) => {
    if (isLive) {
      const res = await sellerService.updateOrderStatus(id, status, courier, trackingNumber);
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, status, ...(courier ? { courier } : {}), ...(trackingNumber ? { trackingNumber } : {}) }
          : o
      )
    );
    showToast(`Order updated to ${status.replace(/_/g, ' ')}.`);
  };

  const handleCancelSellerOrder = async (id: string) => {
    if (isLive) {
      const res = await sellerService.cancelSellerOrder(id, 'Cancelled by seller');
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'cancelled' } : o)));
    setConfirmCancelOrderId(null);
    showToast('Order cancelled and stock restored.');
  };

  const handleInspectRestock = async (
    refundId: string,
    decision: 'restocked' | 'rejected_damaged'
  ) => {
    setInspectingRefundId(refundId);
    const res = await sellerService.inspectReturnedRestock(
      refundId,
      decision,
      inspectionNotes[refundId]
    );
    setInspectingRefundId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    setRefunds((prev) =>
      prev.map((rf) => (rf.refundId === refundId ? { ...rf, restockStatus: decision } : rf))
    );
    showToast(
      decision === 'restocked'
        ? `Returned inventory inspected and restocked (${res.restockedUnits ?? 0} units).`
        : 'Returned items marked damaged — inventory not restocked.'
    );
  };

  const handleUploadKycDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setKycUploading(true);
    const res = await sellerService.uploadSettlementKycDocument(user.id, file);
    setKycUploading(false);
    if (res.error || !res.path) {
      showToast(res.error || 'Could not upload KYC document.', 'error');
      return;
    }
    setOnboardingForm((prev) => ({
      ...prev,
      kycStoragePaths: [...prev.kycStoragePaths, res.path!],
    }));
    showToast('KYC verification document uploaded to private vault.');
  };

  const handleSubmitOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onboardingForm.sellerConsentAccepted || !onboardingForm.agreementAccepted) {
      showToast('Please accept both the settlement consent and seller agreement.', 'error');
      return;
    }
    setOnboardingBusy(true);
    const res = await sellerService.submitSettlementOnboarding({
      legalBusinessName: onboardingForm.legalBusinessName,
      businessType: onboardingForm.businessType,
      contactName: onboardingForm.contactName,
      contactEmail: onboardingForm.contactEmail,
      contactPhone: onboardingForm.contactPhone,
      panLast4: onboardingForm.panLast4,
      gstin: onboardingForm.gstin || undefined,
      beneficiaryName: onboardingForm.beneficiaryName,
      bankAccountLast4: onboardingForm.bankAccountLast4,
      bankIfsc: onboardingForm.bankIfsc,
      settlementDestinationType: 'bank_account',
      registeredAddress: {
        street1: onboardingForm.street1,
        city: onboardingForm.city,
        state: onboardingForm.state,
        postal_code: onboardingForm.postalCode,
        country: 'IN',
      },
      kycStoragePaths: onboardingForm.kycStoragePaths,
      sellerConsentAccepted: onboardingForm.sellerConsentAccepted,
      agreementAccepted: onboardingForm.agreementAccepted,
      agreementVersion: 'nohaj-route-seller-v1',
    });
    setOnboardingBusy(false);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive && user && !user.is_demo) {
      const refreshed = await sellerService.fetchWorkspace(user.id);
      if (!refreshed.error) {
        setSettlementAccount(refreshed.settlementAccount);
      }
    } else {
      setSettlementAccount({
        id: res.accountId || 'ssa-demo',
        sellerId: sellerId || 'demo-seller',
        legalBusinessName: onboardingForm.legalBusinessName,
        businessType: onboardingForm.businessType,
        contactName: onboardingForm.contactName,
        contactEmail: onboardingForm.contactEmail,
        contactPhone: onboardingForm.contactPhone,
        panLast4: onboardingForm.panLast4.toUpperCase(),
        gstin: onboardingForm.gstin || null,
        beneficiaryName: onboardingForm.beneficiaryName,
        bankAccountLast4: onboardingForm.bankAccountLast4,
        bankIfsc: onboardingForm.bankIfsc.toUpperCase(),
        settlementDestinationType: 'bank_account',
        registeredAddress: {
          street1: onboardingForm.street1,
          city: onboardingForm.city,
          state: onboardingForm.state,
          postal_code: onboardingForm.postalCode,
          country: 'IN',
        },
        kycStoragePaths: onboardingForm.kycStoragePaths,
        kycStatus: 'submitted',
        routeOnboardingStatus: 'submitted',
        payoutsEnabled: false,
        sellerConsentAccepted: true,
        agreementAccepted: true,
        updatedAt: new Date().toISOString(),
      });
    }
    showToast('Settlement onboarding submitted for verification.');
  };

  return (
    <div className="min-h-[80vh] bg-[#F2EDE4] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#FAF9F6] border-r border-[#D8CBB9] p-6 shrink-0">
        <div className="pb-6 border-b border-[#D8CBB9]">
          <p className="text-[11px] uppercase tracking-widest text-[#777168]">Seller Workspace</p>
          <p className="font-serif text-lg text-[#25231F] mt-1 truncate">{storeProfile.storeName}</p>
          <p className="text-xs text-[#78816A] mt-1 capitalize">
            Account: {storeProfile.accountStatus.replace(/_/g, ' ')}
          </p>
          <p className="text-[11px] text-[#777168] mt-0.5">
            Email: {storeProfile.emailVerified ? 'Verified' : 'Unverified'}
          </p>
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
                {activeTab === 'store'
                  ? 'Store Profile'
                  : activeTab === 'refunds'
                    ? 'Refunds & Financial Ledger'
                    : activeTab}
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
          {loading ? (
            <div className="p-10 border border-[#D8CBB9] bg-[#FAF9F6] text-center">
              <p className="text-sm text-[#777168]">Loading seller workspace...</p>
            </div>
          ) : loadError ? (
            <div className="p-10 border border-[#A65F46] bg-[#FAF9F6] text-center">
              <p className="font-serif text-xl text-[#25231F]">Unable to load seller workspace</p>
              <p className="mt-2 text-sm text-[#A65F46]">{loadError}</p>
            </div>
          ) : (
            <>
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
                  { label: isLive ? 'Gross Sales' : 'Gross Sales (Demo)', value: formatINR(grossSales) },
                  { label: isLive ? 'Est. Earnings' : 'Est. Earnings (Demo)', value: formatINR(estimatedEarnings) },
                ].map((stat) => (
                  <div key={stat.label} className="p-5 bg-[#FAF9F6] border border-[#D8CBB9]">
                    <p className="text-[11px] uppercase tracking-wider text-[#777168]">{stat.label}</p>
                    <p className="font-serif text-2xl text-[#25231F] mt-2 tabular-nums">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-serif text-xl text-[#25231F]">Store Status & Payout Eligibility</h2>
                  <p className="text-sm text-[#514B43] mt-1 capitalize">
                    Email Verified: <strong>{storeProfile.emailVerified ? 'Yes' : 'No'}</strong> ·
                    Account Status: <strong>{storeProfile.accountStatus.replace(/_/g, ' ')}</strong> ·
                    Payout Verification:{' '}
                    <strong className="text-[#A65F46]">{storeProfile.payoutVerificationStatus}</strong>
                  </p>
                  {storeProfile.accountStatus === 'pending_approval' && (
                    <p className="text-xs text-[#A65F46] mt-1.5">
                      Your email is verified and your seller application is awaiting NOHAJ admin activation. You can prepare product drafts now; listings can go live after store activation and product approval.
                    </p>
                  )}
                  {storeProfile.accountStatus === 'pending_email_verification' && (
                    <p className="text-xs text-[#A65F46] mt-1.5">
                      Please verify your email address before creating product drafts or submitting listings.
                    </p>
                  )}
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
                      {communities.map((c) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <select
                      value={productForm.category}
                      onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                      className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                    >
                      {(categories.length > 0
                        ? categories.map((c) => c.name)
                        : ['Mekhela Sador', 'Dokhona', 'Gamosa & Stoles', 'Traditional Sets', 'Handwoven Textiles', 'Shawls & Wraps']
                      ).map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
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
                      <option value="Handwoven">Handwoven</option>
                      <option value="Traditional Loom">Traditional Loom</option>
                      <option value="Artisan-Crafted">Artisan-Crafted</option>
                      <option value="Handmade">Handmade</option>
                      <option value="Powerloom">Powerloom</option>
                      <option value="Sourced">Sourced</option>
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
                  <div>
                    <p className="text-xs uppercase tracking-wider text-[#777168] mb-2">Occasions</p>
                    <div className="flex flex-wrap gap-3">
                      {OCCASIONS.map((occ) => (
                        <label key={occ.filter} className="inline-flex items-center gap-2 text-xs text-[#25231F] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={productForm.occasion.includes(occ.filter)}
                            onChange={() => toggleOccasion(occ.filter)}
                            className="accent-[#A65F46]"
                          />
                          <span>{occ.title}</span>
                        </label>
                      ))}
                    </div>
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
                  <div className="flex flex-wrap items-center gap-2 pt-2">
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
                    {canSellerCancelOrderStatus(o.status) &&
                      (confirmCancelOrderId === o.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCancelSellerOrder(o.id)}
                            className="px-3.5 py-2 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-wider"
                          >
                            Confirm Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmCancelOrderId(null)}
                            className="px-3 py-2 border border-[#D8CBB9] text-xs uppercase tracking-wider text-[#514B43]"
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmCancelOrderId(o.id)}
                          className="px-4 py-2 border border-[#A65F46] text-[#A65F46] text-xs uppercase tracking-wider hover:bg-[#A65F46] hover:text-[#FAF9F6] transition-colors"
                        >
                          Cancel Order
                        </button>
                      ))}
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
                Estimates shown below — live payouts require verified Razorpay Route onboarding.
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
                  <span>Recorded Online Settled Transfers</span>
                  <span className="tabular-nums">
                    {formatInrFromPaise(settlementSummary?.settledPaise ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* SETTLEMENTS & KYC (Razorpay Route + COD Separation) */}
          {activeTab === 'settlements' && (
            <div className="space-y-8">
              {/* Account Onboarding Status Header */}
              <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-3 pb-3 border-b border-[#E6DED2]">
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-[#777168]">
                      Razorpay Route Settlement Onboarding
                    </p>
                    <h2 className="font-serif text-2xl text-[#25231F] mt-0.5">
                      Payout Verification & Bank Account
                    </h2>
                  </div>
                  <span className="text-xs uppercase tracking-wider px-3 py-1 border border-[#D8CBB9] bg-[#F2EDE4] text-[#25231F]">
                    {(settlementAccount?.routeOnboardingStatus || 'not_started').replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-[#777168] uppercase tracking-wider text-[10px]">Linked Account ID</p>
                    <p className="font-medium text-[#25231F] mt-0.5 tabular-nums">
                      {settlementAccount?.razorpayLinkedAccountId || 'Not yet created by Nohaj Ops'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#777168] uppercase tracking-wider text-[10px]">Payout Eligibility</p>
                    <p className="font-medium text-[#25231F] mt-0.5">
                      {settlementAccount?.payoutsEnabled
                        ? 'Active (Verified by Razorpay Route)'
                        : 'Pending Verification (Disabled until activated)'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#777168] uppercase tracking-wider text-[10px]">Verified Bank Destination</p>
                    <p className="font-medium text-[#25231F] mt-0.5 tabular-nums">
                      {settlementAccount?.bankAccountLast4
                        ? `XXXX-${settlementAccount.bankAccountLast4} · ${settlementAccount.bankIfsc}`
                        : 'Not submitted'}
                    </p>
                  </div>
                </div>
                {settlementAccount?.rejectionReason && (
                  <p className="text-xs text-[#A65F46] pt-1">
                    Verification Action / Reason: {settlementAccount.rejectionReason}
                  </p>
                )}
              </div>

              {/* Financial Settlement Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Online Gross Sales', value: formatInrFromPaise(settlementSummary?.grossSalesPaise ?? 0) },
                  { label: 'Nohaj Commission (12%)', value: `-${formatInrFromPaise(settlementSummary?.commissionPaise ?? 0)}` },
                  { label: 'Refund Deductions', value: `-${formatInrFromPaise(settlementSummary?.refundDeductionsPaise ?? 0)}` },
                  { label: 'Net Seller Payable', value: formatInrFromPaise(settlementSummary?.sellerPayablePaise ?? 0) },
                  { label: 'Pending Transfers', value: formatInrFromPaise(settlementSummary?.pendingTransfersPaise ?? 0) },
                  { label: 'Settled to Bank', value: formatInrFromPaise(settlementSummary?.settledPaise ?? 0) },
                  { label: 'Failed Transfers', value: formatInrFromPaise(settlementSummary?.failedTransfersPaise ?? 0) },
                  { label: 'Reversed Transfers', value: formatInrFromPaise(settlementSummary?.reversedTransfersPaise ?? 0) },
                ].map((metric) => (
                  <div key={metric.label} className="p-4 bg-[#FAF9F6] border border-[#D8CBB9]">
                    <p className="text-[10px] uppercase tracking-wider text-[#777168]">{metric.label}</p>
                    <p className="font-serif text-xl text-[#25231F] mt-1 tabular-nums">{metric.value}</p>
                  </div>
                ))}
              </div>

              {/* COD Separate Remittance Summary */}
              <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-2">
                <h3 className="font-serif text-lg text-[#25231F]">COD Collection & Manual Remittance (Separate from Route)</h3>
                <p className="text-xs text-[#777168]">
                  Cash on Delivery orders are reconciled through courier remittance ledgers and never transferred via Razorpay Route.
                </p>
                <div className="grid grid-cols-3 gap-4 pt-2 text-xs tabular-nums">
                  <div>
                    <p className="text-[#777168] uppercase tracking-wider text-[10px]">COD Collected</p>
                    <p className="font-medium text-[#25231F] mt-0.5">
                      {formatInrFromPaise(settlementSummary?.codCollectedPaise ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#777168] uppercase tracking-wider text-[10px]">COD Remitted</p>
                    <p className="font-medium text-[#78816A] mt-0.5">
                      {formatInrFromPaise(settlementSummary?.codRemittedPaise ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#777168] uppercase tracking-wider text-[10px]">COD Outstanding</p>
                    <p className="font-medium text-[#A65F46] mt-0.5">
                      {formatInrFromPaise(settlementSummary?.codOutstandingPaise ?? 0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Onboarding & KYC Form */}
              <form onSubmit={handleSubmitOnboarding} className="p-6 sm:p-8 bg-[#FAF9F6] border border-[#D8CBB9] space-y-4">
                <h3 className="font-serif text-xl text-[#25231F]">Submit / Update Settlement Onboarding</h3>
                <p className="text-xs text-[#777168]">
                  Only masked identifiers (PAN last 4 and bank account last 4) are stored in Nohaj database. Full KYC documents stay private in verified storage.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input
                    type="text"
                    required
                    placeholder="Legal Business Name *"
                    value={onboardingForm.legalBusinessName}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, legalBusinessName: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <select
                    value={onboardingForm.businessType}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, businessType: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  >
                    <option value="individual">Individual Artisan</option>
                    <option value="proprietorship">Sole Proprietorship</option>
                    <option value="partnership">Partnership / Co-op</option>
                    <option value="llp">LLP</option>
                    <option value="private_limited">Private Limited</option>
                  </select>
                  <input
                    type="text"
                    required
                    placeholder="Authorised Contact Name *"
                    value={onboardingForm.contactName}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, contactName: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Settlement Contact Email *"
                    value={onboardingForm.contactEmail}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, contactEmail: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Contact Phone (+91...) *"
                    value={onboardingForm.contactPhone}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, contactPhone: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <input
                    type="text"
                    required
                    maxLength={4}
                    placeholder="PAN Last 4 Chars (e.g. 234F) *"
                    value={onboardingForm.panLast4}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, panLast4: e.target.value.toUpperCase() }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm uppercase"
                  />
                  <input
                    type="text"
                    placeholder="GSTIN (Optional)"
                    value={onboardingForm.gstin}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm uppercase"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Bank Account Beneficiary Name *"
                    value={onboardingForm.beneficiaryName}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, beneficiaryName: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <input
                    type="text"
                    required
                    maxLength={4}
                    placeholder="Bank Account Last 4 Digits *"
                    value={onboardingForm.bankAccountLast4}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, bankAccountLast4: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm tabular-nums"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Bank IFSC Code *"
                    value={onboardingForm.bankIfsc}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, bankIfsc: e.target.value.toUpperCase() }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm uppercase"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Registered Street Address *"
                    value={onboardingForm.street1}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, street1: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <input
                    type="text"
                    required
                    placeholder="City *"
                    value={onboardingForm.city}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, city: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <input
                    type="text"
                    required
                    placeholder="State *"
                    value={onboardingForm.state}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, state: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Postal Code *"
                    value={onboardingForm.postalCode}
                    onChange={(e) => setOnboardingForm((p) => ({ ...p, postalCode: e.target.value }))}
                    className="px-3.5 py-2.5 bg-[#F2EDE4] border border-[#D8CBB9] text-sm tabular-nums"
                  />
                </div>

                <div className="pt-2 space-y-2">
                  <label className="block text-xs uppercase tracking-wider text-[#777168]">
                    Private KYC Verification Document (PAN / Cancelled Cheque)
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={kycUploading}
                    onChange={handleUploadKycDoc}
                    className="text-xs text-[#514B43]"
                  />
                  {onboardingForm.kycStoragePaths.length > 0 && (
                    <p className="text-xs text-[#78816A]">
                      {onboardingForm.kycStoragePaths.length} private document(s) attached.
                    </p>
                  )}
                </div>

                <div className="space-y-2 pt-2 text-xs text-[#514B43]">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onboardingForm.sellerConsentAccepted}
                      onChange={(e) =>
                        setOnboardingForm((p) => ({ ...p, sellerConsentAccepted: e.target.checked }))
                      }
                      className="mt-0.5 accent-[#A65F46]"
                    />
                    <span>
                      I consent to Nohaj submitting my verified KYC details to Razorpay Route for Linked Account onboarding.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onboardingForm.agreementAccepted}
                      onChange={(e) =>
                        setOnboardingForm((p) => ({ ...p, agreementAccepted: e.target.checked }))
                      }
                      className="mt-0.5 accent-[#A65F46]"
                    />
                    <span>
                      I accept the Nohaj Marketplace Seller Settlement Agreement (nohaj-route-seller-v1), including 12% marketplace commission and refund reversal terms.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={onboardingBusy}
                  className="px-7 py-3 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest hover:bg-[#A65F46] disabled:opacity-60"
                >
                  {onboardingBusy ? 'Submitting...' : 'Submit Onboarding for Verification'}
                </button>
              </form>

              {/* Transfer & Bank Settlement History */}
              <div className="space-y-3">
                <h3 className="font-serif text-xl text-[#25231F]">Route Transfer & Settlement History</h3>
                {transfers.length === 0 && settlementRecords.length === 0 ? (
                  <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#777168]">
                    No Route transfers or bank settlements recorded yet.
                  </div>
                ) : (
                  <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
                    {transfers.map((tr) => (
                      <div key={tr.id} className="p-4 text-xs flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-medium text-[#25231F] tabular-nums">{tr.orderNumber}</span>
                          <span className="ml-2 text-[#777168]">
                            Transfer: {tr.status.replace(/_/g, ' ')} · Settlement: {tr.settlementStatus.replace(/_/g, ' ')}
                          </span>
                          {tr.providerTransferId && (
                            <p className="text-[#777168] mt-0.5 tabular-nums">
                              Ref: {tr.providerTransferId}
                              {tr.settlementUtr ? ` · UTR: ${tr.settlementUtr}` : ''}
                            </p>
                          )}
                          {tr.failureReason && (
                            <p className="text-[#A65F46] mt-0.5">{tr.failureReason}</p>
                          )}
                        </div>
                        <div className="text-right tabular-nums">
                          <p className="font-medium text-[#25231F]">{formatInrFromPaise(tr.amountPaise)}</p>
                          {tr.reversedPaise > 0 && (
                            <p className="text-[#A65F46]">Reversed: -{formatInrFromPaise(tr.reversedPaise)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* REFUNDS & LEDGER */}
          {activeTab === 'refunds' && (
            <div className="space-y-8">
              <div className="space-y-4">
                <h2 className="font-serif text-2xl text-[#25231F]">Seller Refund Adjustments & Returns</h2>
                {refunds.length === 0 ? (
                  <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#777168]">
                    No refunds recorded for your seller orders.
                  </div>
                ) : (
                  refunds.map((rf) => (
                    <div key={rf.refundId} className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3">
                      <div className="flex flex-wrap justify-between gap-2 pb-3 border-b border-[#E6DED2]">
                        <div>
                          <span className="font-medium text-sm text-[#25231F] tabular-nums">
                            {rf.orderNumber}
                          </span>
                          <span className="ml-3 text-xs text-[#777168]">
                            {rf.refundChannel === 'razorpay' ? 'Online (Razorpay)' : 'COD Manual'} ·{' '}
                            {rf.refundType.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <span className="text-xs uppercase tracking-wider px-2.5 py-1 border border-[#D8CBB9] bg-[#F2EDE4] text-[#25231F]">
                          {getRefundStatusLabel(rf.status, rf.requestStatus)}
                        </span>
                      </div>
                      <p className="text-xs text-[#514B43]">Reason: {rf.reason}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
                        <div>
                          <p className="text-[#777168] uppercase tracking-wider text-[10px]">Gross Refund Share</p>
                          <p className="tabular-nums font-medium text-[#25231F] mt-0.5">
                            {formatInrFromPaise(rf.grossRefundPaise)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#777168] uppercase tracking-wider text-[10px]">Commission Reversed</p>
                          <p className="tabular-nums font-medium text-[#78816A] mt-0.5">
                            {formatInrFromPaise(rf.commissionReversedPaise)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#777168] uppercase tracking-wider text-[10px]">Seller Payable Reversed</p>
                          <p className="tabular-nums font-medium text-[#A65F46] mt-0.5">
                            -{formatInrFromPaise(rf.sellerPayableReversedPaise)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#777168] uppercase tracking-wider text-[10px]">Restock Inspection</p>
                          <p className="capitalize font-medium text-[#25231F] mt-0.5">
                            {rf.restockStatus.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                      {rf.courierDeductionPaise > 0 && (
                        <p className="text-xs text-[#777168] tabular-nums">
                          Courier Deduction: {formatInrFromPaise(rf.courierDeductionPaise)}
                        </p>
                      )}
                      {rf.restockStatus === 'pending_inspection' && (
                        <div className="pt-3 border-t border-[#E6DED2] flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            placeholder="Inspection notes (e.g. packaging intact)..."
                            value={inspectionNotes[rf.refundId] || ''}
                            onChange={(e) =>
                              setInspectionNotes((prev) => ({
                                ...prev,
                                [rf.refundId]: e.target.value,
                              }))
                            }
                            className="flex-1 min-w-[200px] px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                          />
                          <button
                            type="button"
                            disabled={inspectingRefundId === rf.refundId}
                            onClick={() => handleInspectRestock(rf.refundId, 'restocked')}
                            className="px-3.5 py-1.5 bg-[#78816A] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                          >
                            Approve & Restock
                          </button>
                          <button
                            type="button"
                            disabled={inspectingRefundId === rf.refundId}
                            onClick={() => handleInspectRestock(rf.refundId, 'rejected_damaged')}
                            className="px-3.5 py-1.5 border border-[#A65F46] text-[#A65F46] text-xs uppercase tracking-wider disabled:opacity-60"
                          >
                            Mark Damaged
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <h2 className="font-serif text-xl text-[#25231F]">Seller Financial Ledger (Append-Only)</h2>
                {ledgerEntries.length === 0 ? (
                  <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#777168]">
                    No financial ledger entries recorded yet.
                  </div>
                ) : (
                  <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
                    {ledgerEntries.map((entry) => (
                      <div key={entry.id} className="p-4 text-xs flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-medium uppercase tracking-wider text-[#25231F]">
                            {entry.entryType.replace(/_/g, ' ')}
                          </span>
                          <p className="text-[#514B43] mt-0.5">{entry.description}</p>
                          {entry.referenceId && (
                            <p className="text-[#777168] tabular-nums">Ref: {entry.referenceId}</p>
                          )}
                        </div>
                        <div className="text-right tabular-nums">
                          <span
                            className={`font-medium ${
                              entry.direction === 'debit' ? 'text-[#A65F46]' : 'text-[#78816A]'
                            }`}
                          >
                            {entry.direction === 'debit' ? '-' : '+'}
                            {formatInrFromPaise(entry.amountPaise)}
                          </span>
                          <p className="text-[#777168] mt-0.5">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
