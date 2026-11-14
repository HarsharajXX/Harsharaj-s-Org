import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  FileText,
  Globe,
  Landmark,
  LayoutDashboard,
  Menu,
  MessageSquare,
  RotateCcw,
  Settings,
  Shield,
  ShoppingBag,
  Store,
  Users,
  X,
} from 'lucide-react';
import {
  AdminAuditLog,
  AdminCodRecord,
  AdminLedgerEntry,
  AdminOrderRecord,
  AdminProductSubmission,
  AdminRefundRecord,
  AdminSellerRecord,
  AdminTab,
  DEMO_ADMIN_COD_RECORDS,
  DEMO_ADMIN_LEDGER_ENTRIES,
  DEMO_ADMIN_ORDERS,
  DEMO_ADMIN_RECONCILIATION_RUNS,
  DEMO_ADMIN_REFUNDS,
  DEMO_ADMIN_SELLERS,
  DEMO_ADMIN_SETTLEMENT_ACCOUNTS,
  DEMO_ADMIN_SETTLEMENT_RECORDS,
  DEMO_ADMIN_SUBMISSIONS,
  DEMO_ADMIN_TRANSFERS,
  DEMO_ADMIN_TRANSFER_REVERSALS,
  DEMO_ROUTE_GATEWAY,
  MarketplaceSettings,
  adminService,
  canAccessAdminTab,
} from '../../services/adminService';
import { UserRole } from '../../services/auth';
import type { SellerAccountStatus } from '../../types';
import { useCatalogue } from '../../hooks/useCatalogue';
import { formatINR } from '../../utils/format';
import { canAdminCancelOrder } from '../../utils/commerceRules';
import { getRefundStatusLabel } from '../../services/payments/paymentStatus';
import { CodCancellationStage, formatInrFromPaise, inrToPaise } from '../../services/payments/paymentTypes';
import type {
  AdminReconciliationRun,
  AdminRouteGatewayState,
  AdminTransferReversalItem,
  SellerSettlementAccount,
  SellerSettlementPayoutRecord,
  SellerTransferItem,
} from '../../services/payments/settlementTypes';
import { useStore } from '../../context/StoreContext';

export const AdminDashboardPage: React.FC = () => {
  const { user, showToast } = useStore();
  const { communities } = useCatalogue();
  const isLive = adminService.isLive();

  const resolvedLiveRole: UserRole =
    user?.roles.find((r) =>
      r === 'super_admin' || r === 'operations_admin' || r === 'content_admin'
    ) || 'content_admin';

  const [demoRole, setDemoRole] = useState<UserRole>('super_admin');
  const adminRole: UserRole = isLive ? resolvedLiveRole : demoRole;

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loading, setLoading] = useState(isLive);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sellers, setSellers] = useState<AdminSellerRecord[]>(isLive ? [] : DEMO_ADMIN_SELLERS);
  const [submissions, setSubmissions] = useState<AdminProductSubmission[]>(
    isLive ? [] : DEMO_ADMIN_SUBMISSIONS
  );
  const [orders, setOrders] = useState<AdminOrderRecord[]>(isLive ? [] : DEMO_ADMIN_ORDERS);
  const [refunds, setRefunds] = useState<AdminRefundRecord[]>(isLive ? [] : DEMO_ADMIN_REFUNDS);
  const [codRecords, setCodRecords] = useState<AdminCodRecord[]>(
    isLive ? [] : DEMO_ADMIN_COD_RECORDS
  );
  const [ledgerEntries, setLedgerEntries] = useState<AdminLedgerEntry[]>(
    isLive ? [] : DEMO_ADMIN_LEDGER_ENTRIES
  );
  const [settlementAccounts, setSettlementAccounts] = useState<SellerSettlementAccount[]>(
    isLive ? [] : DEMO_ADMIN_SETTLEMENT_ACCOUNTS
  );
  const [transfers, setTransfers] = useState<SellerTransferItem[]>(
    isLive ? [] : DEMO_ADMIN_TRANSFERS
  );
  const [transferReversals, setTransferReversals] = useState<AdminTransferReversalItem[]>(
    isLive ? [] : DEMO_ADMIN_TRANSFER_REVERSALS
  );
  const [settlementRecords, setSettlementRecords] = useState<SellerSettlementPayoutRecord[]>(
    isLive ? [] : DEMO_ADMIN_SETTLEMENT_RECORDS
  );
  const [reconciliationRuns, setReconciliationRuns] = useState<AdminReconciliationRun[]>(
    isLive ? [] : DEMO_ADMIN_RECONCILIATION_RUNS
  );
  const [routeGateway, setRouteGateway] = useState<AdminRouteGatewayState>(DEMO_ROUTE_GATEWAY);
  const [onboardingReviewNotes, setOnboardingReviewNotes] = useState<Record<string, string>>({});
  const [routePanInputs, setRoutePanInputs] = useState<Record<string, string>>({});
  const [routeBankInputs, setRouteBankInputs] = useState<Record<string, string>>({});
  const [settlementBusyId, setSettlementBusyId] = useState<string | null>(null);
  const [transferForm, setTransferForm] = useState({
    sellerOrderId: '',
    amountInr: '',
    onHold: false,
  });
  const [reversalForm, setReversalForm] = useState({
    transferId: '',
    amountInr: '',
    refundId: '',
    reason: '',
  });
  const [customerCount, setCustomerCount] = useState<number>(isLive ? 0 : 2);
  const [settings, setSettings] = useState<MarketplaceSettings>({
    commissionRate: 12,
    codEnabled: true,
    freeShippingThreshold: 5000,
    returnWindowDays: 7,
  });
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>(
    isLive
      ? []
      : [
          {
            id: 'log-1',
            actorRole: 'super_admin',
            action: 'INITIALIZE_MARKETPLACE',
            target: 'marketplace_settings',
            details: 'Default commission set to 12% (Demo Mode)',
            createdAt: new Date().toISOString(),
          },
        ]
  );

  const [rejectFeedback, setRejectFeedback] = useState<Record<string, string>>({});
  const [sellerSearch, setSellerSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');

  const [refundChannelFilter, setRefundChannelFilter] = useState<'all' | 'razorpay' | 'cod_manual'>('all');
  const [refundStatusFilter, setRefundStatusFilter] = useState<
    'all' | 'requested' | 'approved' | 'pending' | 'processed' | 'failed' | 'rejected'
  >('all');
  const [refundNoteDrafts, setRefundNoteDrafts] = useState<Record<string, string>>({});
  const [refundRejectDrafts, setRefundRejectDrafts] = useState<Record<string, string>>({});
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);

  const [onlineRefundForm, setOnlineRefundForm] = useState({
    orderId: '',
    sellerOrderId: '',
    amountInr: '',
    shippingInr: '0',
    reason: '',
    internalNotes: '',
  });
  const [codCancelForm, setCodCancelForm] = useState<{
    sellerOrderId: string;
    stage: Exclude<CodCancellationStage, 'manual_refund_after_collection'>;
    courierDeductionInr: string;
    courierName: string;
    reason: string;
  }>({
    sellerOrderId: '',
    stage: 'before_collection',
    courierDeductionInr: '0',
    courierName: '',
    reason: '',
  });
  const [manualCodForm, setManualCodForm] = useState({
    orderId: '',
    sellerOrderId: '',
    amountInr: '',
    courierDeductionInr: '0',
    refundMethod: 'upi',
    manualReference: '',
    refundDate: new Date().toISOString().slice(0, 10),
    reason: '',
    internalNotes: '',
  });

  const reloadAdminData = async () => {
    if (!isLive) return;
    const res = await adminService.fetchAdminData(adminRole);
    if (res.error) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setSellers(res.sellers);
    setSubmissions(res.submissions);
    setOrders(res.orders);
    setRefunds(res.refunds);
    setCodRecords(res.codRecords);
    setLedgerEntries(res.ledgerEntries);
    setSettlementAccounts(res.settlementAccounts);
    setTransfers(res.transfers);
    setTransferReversals(res.transferReversals);
    setSettlementRecords(res.settlementRecords);
    setReconciliationRuns(res.reconciliationRuns);
    setRouteGateway(res.routeGateway);
    setSettings(res.settings);
    setAuditLogs(res.auditLogs);
    setCustomerCount(res.customerCount);
  };

  useEffect(() => {
    if (!isLive) return;
    let active = true;
    setLoading(true);
    adminService.fetchAdminData(adminRole).then((res) => {
      if (!active) return;
      setLoading(false);
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
      setSellers(res.sellers);
      setSubmissions(res.submissions);
      setOrders(res.orders);
      setRefunds(res.refunds);
      setCodRecords(res.codRecords);
      setLedgerEntries(res.ledgerEntries);
      setSettlementAccounts(res.settlementAccounts);
      setTransfers(res.transfers);
      setTransferReversals(res.transferReversals);
      setSettlementRecords(res.settlementRecords);
      setReconciliationRuns(res.reconciliationRuns);
      setRouteGateway(res.routeGateway);
      setSettings(res.settings);
      setAuditLogs(res.auditLogs);
      setCustomerCount(res.customerCount);
    });
    return () => {
      active = false;
    };
  }, [isLive, adminRole]);

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
    { id: 'refunds', label: 'Refunds & COD', icon: <RotateCcw className="w-4 h-4" /> },
    { id: 'settlements', label: 'Seller Settlements', icon: <Landmark className="w-4 h-4" /> },
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

  const handleSellerStatus = async (id: string, accountStatus: SellerAccountStatus) => {
    if (isLive && user) {
      const res = await adminService.updateSellerStatus(id, accountStatus, user.id);
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, accountStatus } : s)));
    setSubmissions((prev) =>
      prev.map((p) => (p.sellerId === id ? { ...p, sellerStatus: accountStatus } : p))
    );
    recordAudit('UPDATE_SELLER_STATUS', id, `Set accountStatus to ${accountStatus}`);
    showToast(`Seller status updated to ${accountStatus.replace(/_/g, ' ')}.`);
  };

  const handleSellerPayout = async (
    id: string,
    payoutVerification: 'verified' | 'pending' | 'unverified'
  ) => {
    if (isLive && user) {
      const res = await adminService.updateSellerPayout(id, payoutVerification, user.id);
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, payoutVerification } : s)));
    recordAudit('UPDATE_PAYOUT_VERIFICATION', id, `Set payoutVerification to ${payoutVerification}`);
    showToast(`Payout verification set to ${payoutVerification}.`);
  };

  const handleModerateProduct = async (
    id: string,
    status: AdminProductSubmission['status'],
    isFeatured?: boolean
  ) => {
    if (status === 'rejected' && !rejectFeedback[id]?.trim()) {
      showToast('Please enter mandatory rejection feedback.', 'error');
      return;
    }
    if (isLive && user) {
      const res = await adminService.moderateProduct(
        id,
        status,
        rejectFeedback[id],
        user.id,
        isFeatured
      );
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setSubmissions((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              status,
              ...(typeof isFeatured === 'boolean' ? { isFeatured } : {}),
              feedback: rejectFeedback[id] || p.feedback,
            }
          : p
      )
    );
    recordAudit('MODERATE_PRODUCT', id, `Changed product status to ${status}`);
    showToast(`Product marked as ${status.replace(/_/g, ' ')}.`);
  };

  const handleToggleFeatured = async (id: string, nextFeatured: boolean) => {
    if (isLive && user) {
      const res = await adminService.setProductFeatured(id, nextFeatured, user.id);
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setSubmissions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isFeatured: nextFeatured } : p))
    );
    recordAudit('TOGGLE_FEATURED_PRODUCT', id, `Set is_featured to ${nextFeatured}`);
    showToast(nextFeatured ? 'Marked as featured.' : 'Removed from featured.');
  };

  const handleAdminCancelOrder = async (orderId: string) => {
    if (isLive) {
      const res = await adminService.cancelCustomerOrder(orderId, 'Cancelled by operations admin');
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              orderStatus: 'cancelled',
              sellerOrders: o.sellerOrders.map((so) => ({
                ...so,
                fulfilmentStatus: 'cancelled',
                codReconciliationStatus:
                  so.codReconciliationStatus === 'awaiting_collection'
                    ? 'not_applicable'
                    : so.codReconciliationStatus,
              })),
            }
          : o
      )
    );
    recordAudit('CANCEL_ORDER', orderId, 'Order cancelled with inventory restoration');
    showToast('Order cancelled and inventory restored.');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLive && user) {
      const res = await adminService.saveSettings(settings, user.id);
      if (res.error) {
        showToast(res.error, 'error');
        return;
      }
    }
    recordAudit(
      'UPDATE_MARKETPLACE_SETTINGS',
      'marketplace_settings',
      `Commission: ${settings.commissionRate}%, COD: ${settings.codEnabled}`
    );
    showToast('Marketplace settings saved & recorded in audit_logs.');
  };

  const handleReviewRefund = async (refundId: string, decision: 'approved' | 'rejected') => {
    const rejectionReason = refundRejectDrafts[refundId]?.trim();
    if (decision === 'rejected' && !rejectionReason) {
      showToast('Enter a rejection reason for the customer.', 'error');
      return;
    }
    setRefundBusyId(refundId);
    const res = await adminService.reviewRefundRequest(
      refundId,
      decision,
      rejectionReason,
      refundNoteDrafts[refundId]?.trim()
    );
    setRefundBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) {
      await reloadAdminData();
    } else {
      setRefunds((prev) =>
        prev.map((rf) =>
          rf.id === refundId
            ? {
                ...rf,
                requestStatus: decision,
                rejectionReason: decision === 'rejected' ? rejectionReason : rf.rejectionReason,
                internalNotes: refundNoteDrafts[refundId]?.trim() || rf.internalNotes,
              }
            : rf
        )
      );
    }
    recordAudit(`REFUND_${decision.toUpperCase()}`, refundId, rejectionReason || 'Approved by admin');
    showToast(`Refund request ${decision}.`);
  };

  const handleTriggerRazorpayRefund = async (rf: AdminRefundRecord) => {
    setRefundBusyId(rf.id);
    const res = await adminService.initiateOnlineRefund({
      orderId: rf.orderId,
      refundId: rf.id,
      reason: rf.reason,
      internalNotes: refundNoteDrafts[rf.id]?.trim() || rf.internalNotes || null,
      idempotencyKey: `adm-rfnd:${rf.id}:${rf.status === 'failed' ? Date.now() : 'exec'}`,
    });
    setRefundBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) {
      await reloadAdminData();
    } else {
      setRefunds((prev) =>
        prev.map((item) =>
          item.id === rf.id
            ? {
                ...item,
                status: res.status || 'processed',
                requestStatus: res.status === 'failed' ? 'failed' : 'completed',
                providerRefundId: res.providerRefundId || item.providerRefundId,
              }
            : item
        )
      );
    }
    recordAudit('INITIATE_RAZORPAY_REFUND', rf.id, `Status: ${res.status || 'pending'}`);
    showToast(`Razorpay refund ${res.status || 'initiated'}.`);
  };

  const handleApproveRestock = async (
    refundId: string,
    decision: 'restocked' | 'rejected_damaged'
  ) => {
    setRefundBusyId(refundId);
    const res = await adminService.approveReturnRestock(
      refundId,
      decision,
      refundNoteDrafts[refundId]?.trim()
    );
    setRefundBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) {
      await reloadAdminData();
    } else {
      setRefunds((prev) =>
        prev.map((item) => (item.id === refundId ? { ...item, restockStatus: decision } : item))
      );
    }
    recordAudit('APPROVE_RETURN_RESTOCK', refundId, `Decision: ${decision}`);
    showToast(decision === 'restocked' ? 'Return inspected and restocked.' : 'Return marked damaged.');
  };

  const handleCreateOnlineRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onlineRefundForm.orderId || !onlineRefundForm.reason.trim()) {
      showToast('Select an online order and provide a refund reason.', 'error');
      return;
    }
    const amountPaise = onlineRefundForm.amountInr
      ? inrToPaise(Number(onlineRefundForm.amountInr))
      : null;
    const shippingRefundPaise = onlineRefundForm.shippingInr
      ? inrToPaise(Number(onlineRefundForm.shippingInr))
      : 0;

    setRefundBusyId('create-online');
    const res = await adminService.initiateOnlineRefund({
      orderId: onlineRefundForm.orderId,
      sellerOrderId: onlineRefundForm.sellerOrderId || null,
      amountPaise,
      shippingRefundPaise,
      reason: onlineRefundForm.reason.trim(),
      internalNotes: onlineRefundForm.internalNotes.trim() || null,
    });
    setRefundBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) {
      await reloadAdminData();
    }
    setOnlineRefundForm({
      orderId: '',
      sellerOrderId: '',
      amountInr: '',
      shippingInr: '0',
      reason: '',
      internalNotes: '',
    });
    recordAudit('CREATE_ONLINE_REFUND', res.refundId || onlineRefundForm.orderId, `Status: ${res.status}`);
    showToast(`Online refund ${res.status || 'initiated'}.`);
  };

  const handleCodCancellationAccounting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codCancelForm.sellerOrderId || !codCancelForm.reason.trim()) {
      showToast('Select a COD seller order and enter a cancellation reason.', 'error');
      return;
    }
    setRefundBusyId('cod-cancel');
    const res = await adminService.cancelCodOrderWithAccounting({
      sellerOrderId: codCancelForm.sellerOrderId,
      stage: codCancelForm.stage,
      courierDeductionPaise: inrToPaise(Number(codCancelForm.courierDeductionInr || 0)),
      courierName: codCancelForm.courierName.trim() || undefined,
      reason: codCancelForm.reason.trim(),
    });
    setRefundBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) {
      await reloadAdminData();
    }
    setCodCancelForm({
      sellerOrderId: '',
      stage: 'before_collection',
      courierDeductionInr: '0',
      courierName: '',
      reason: '',
    });
    recordAudit('COD_CANCEL_ACCOUNTING', codCancelForm.sellerOrderId, `Stage: ${codCancelForm.stage}`);
    showToast('COD cancellation accounting posted.');
  };

  const handleRecordManualCodRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !manualCodForm.orderId ||
      !manualCodForm.sellerOrderId ||
      !manualCodForm.amountInr ||
      !manualCodForm.manualReference.trim() ||
      !manualCodForm.reason.trim()
    ) {
      showToast('Complete order, seller order, amount, manual reference, and reason.', 'error');
      return;
    }
    setRefundBusyId('manual-cod');
    const res = await adminService.recordManualCodRefund({
      orderId: manualCodForm.orderId,
      sellerOrderId: manualCodForm.sellerOrderId,
      amountPaise: inrToPaise(Number(manualCodForm.amountInr)),
      courierDeductionPaise: inrToPaise(Number(manualCodForm.courierDeductionInr || 0)),
      refundMethod: manualCodForm.refundMethod,
      manualReference: manualCodForm.manualReference.trim(),
      refundDate: manualCodForm.refundDate ? new Date(manualCodForm.refundDate).toISOString() : undefined,
      reason: manualCodForm.reason.trim(),
      internalNotes: manualCodForm.internalNotes.trim() || undefined,
    });
    setRefundBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) {
      await reloadAdminData();
    }
    setManualCodForm({
      orderId: '',
      sellerOrderId: '',
      amountInr: '',
      courierDeductionInr: '0',
      refundMethod: 'upi',
      manualReference: '',
      refundDate: new Date().toISOString().slice(0, 10),
      reason: '',
      internalNotes: '',
    });
    recordAudit('RECORD_MANUAL_COD_REFUND', res.refundId || manualCodForm.sellerOrderId, manualCodForm.manualReference);
    showToast('Manual COD refund recorded in financial ledger.');
  };

  const handleReviewOnboarding = async (
    accountId: string,
    decision: 'verification_pending' | 'action_required' | 'rejected' | 'suspended'
  ) => {
    const notes = onboardingReviewNotes[accountId]?.trim();
    if ((decision === 'rejected' || decision === 'action_required') && !notes) {
      showToast('Enter clarification/rejection notes before saving.', 'error');
      return;
    }
    setSettlementBusyId(accountId);
    const res = await adminService.reviewSellerOnboarding(accountId, decision, notes);
    setSettlementBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) {
      await reloadAdminData();
    } else {
      setSettlementAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? {
                ...a,
                routeOnboardingStatus: decision,
                kycStatus: decision,
                payoutsEnabled: false,
                rejectionReason: decision === 'rejected' || decision === 'action_required' ? notes : null,
              }
            : a
        )
      );
    }
    recordAudit('REVIEW_SELLER_SETTLEMENT_ONBOARDING', accountId, `Decision: ${decision}`);
    showToast(`Seller settlement onboarding updated to ${decision.replace(/_/g, ' ')}.`);
  };

  const handleCreateLinkedAccount = async (acct: SellerSettlementAccount) => {
    setSettlementBusyId(`link-${acct.id}`);
    const res = acct.razorpayLinkedAccountId
      ? await adminService.updateRouteLinkedAccount({
          accountId: acct.id,
          sellerId: acct.sellerId,
          bankAccountNumber: routeBankInputs[acct.id]?.trim() || undefined,
          bankIfsc: acct.bankIfsc,
          beneficiaryName: acct.beneficiaryName,
        })
      : await adminService.createRouteLinkedAccount({
          accountId: acct.id,
          sellerId: acct.sellerId,
          pan: routePanInputs[acct.id]?.trim() || undefined,
          bankAccountNumber: routeBankInputs[acct.id]?.trim() || undefined,
          bankIfsc: acct.bankIfsc,
          beneficiaryName: acct.beneficiaryName,
        });
    setSettlementBusyId(null);
    setRoutePanInputs((prev) => ({ ...prev, [acct.id]: '' }));
    setRouteBankInputs((prev) => ({ ...prev, [acct.id]: '' }));
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) await reloadAdminData();
    recordAudit('SYNC_ROUTE_LINKED_ACCOUNT', acct.id, 'Synced Linked Account with Razorpay Route');
    showToast('Razorpay Linked Account synced cleanly.');
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferForm.sellerOrderId) {
      showToast('Select an eligible online seller order.', 'error');
      return;
    }
    setSettlementBusyId('create-transfer');
    const res = await adminService.createRouteTransfer({
      sellerOrderId: transferForm.sellerOrderId,
      amountPaise: transferForm.amountInr ? inrToPaise(Number(transferForm.amountInr)) : undefined,
      onHold: transferForm.onHold,
    });
    setSettlementBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    setTransferForm({ sellerOrderId: '', amountInr: '', onHold: false });
    if (isLive) await reloadAdminData();
    recordAudit('CREATE_ROUTE_TRANSFER', transferForm.sellerOrderId, 'Initiated Route transfer');
    showToast('Razorpay Route transfer initiated.');
  };

  const handleRetryTransfer = async (tr: SellerTransferItem) => {
    setSettlementBusyId(`retry-${tr.id}`);
    const res = await adminService.createRouteTransfer({
      sellerOrderId: tr.sellerOrderId,
      transferId: tr.id,
      onHold: tr.onHold,
      idempotencyKey: `retry:${tr.id}:${Date.now()}`,
    });
    setSettlementBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) await reloadAdminData();
    recordAudit('RETRY_ROUTE_TRANSFER', tr.id, 'Retried failed Route transfer');
    showToast('Failed transfer retried.');
  };

  const handleReverseTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalForm.transferId || !reversalForm.reason.trim()) {
      showToast('Select a transfer and enter a reversal reason.', 'error');
      return;
    }
    setSettlementBusyId('reverse-transfer');
    const res = await adminService.reverseRouteTransfer({
      transferId: reversalForm.transferId,
      amountPaise: reversalForm.amountInr ? inrToPaise(Number(reversalForm.amountInr)) : undefined,
      refundId: reversalForm.refundId.trim() || undefined,
      reason: reversalForm.reason.trim(),
    });
    setSettlementBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    setReversalForm({ transferId: '', amountInr: '', refundId: '', reason: '' });
    if (isLive) await reloadAdminData();
    recordAudit('REVERSE_ROUTE_TRANSFER', reversalForm.transferId, reversalForm.reason.trim());
    showToast('Razorpay Route transfer reversal processed.');
  };

  const handleRunReconciliation = async () => {
    setSettlementBusyId('reconcile');
    const res = await adminService.runRouteReconciliation(50);
    setSettlementBusyId(null);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    if (isLive) await reloadAdminData();
    recordAudit(
      'RUN_ROUTE_RECONCILIATION',
      'seller_transfers',
      `Checked ${res.checkedCount ?? 0} transfers; settled ${res.settledCount ?? 0}`
    );
    showToast(
      `Reconciliation finished: checked ${res.checkedCount ?? 0} transfers, settled ${res.settledCount ?? 0}.`
    );
  };

  return (
    <div className="min-h-[82vh] bg-[#F2EDE4] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#25231F] text-[#E6DED2] p-6 shrink-0">
        <div className="pb-6 border-b border-[#3A3630]">
          <p className="text-[11px] uppercase tracking-widest text-[#D8CBB9]">NOHAJ Control</p>
          <p className="font-serif text-xl text-[#FAF9F6] mt-1">Admin Console</p>
          {!isLive ? (
            <div className="mt-3">
              <label className="block text-[10px] uppercase tracking-wider text-[#777168] mb-1">
                Preview Role (Demo Only)
              </label>
              <select
                value={demoRole}
                onChange={(e) => {
                  const nextRole = e.target.value as UserRole;
                  setDemoRole(nextRole);
                  setActiveTab('overview');
                }}
                className="w-full px-2.5 py-1.5 bg-[#3A3630] border border-[#514B43] text-xs text-[#FAF9F6]"
              >
                <option value="super_admin">Super Admin</option>
                <option value="operations_admin">Operations Admin</option>
                <option value="content_admin">Content Admin</option>
              </select>
            </div>
          ) : (
            <p className="text-xs text-[#D8CBB9] mt-2 capitalize">
              Role: {adminRole.replace(/_/g, ' ')}
            </p>
          )}
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
                {activeTab === 'moderation'
                  ? 'Product Moderation'
                  : activeTab === 'refunds'
                    ? 'Refunds & COD Reconciliation'
                    : activeTab}
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
          {loading ? (
            <div className="p-10 bg-[#FAF9F6] border border-[#D8CBB9] text-center">
              <p className="text-sm text-[#777168]">Loading admin console...</p>
            </div>
          ) : loadError ? (
            <div className="p-10 bg-[#FAF9F6] border border-[#A65F46] text-center">
              <p className="font-serif text-xl text-[#25231F]">Unable to load admin console</p>
              <p className="mt-2 text-sm text-[#A65F46]">{loadError}</p>
            </div>
          ) : (
            <>
          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {(adminRole === 'content_admin'
                ? [
                    { label: 'Total Products', value: submissions.length },
                    { label: 'Published Products', value: submissions.filter((p) => p.status === 'published').length },
                    { label: 'Pending Approvals', value: submissions.filter((p) => p.status === 'pending_review').length },
                    { label: 'Featured Pieces', value: submissions.filter((p) => p.isFeatured).length },
                  ]
                : adminRole === 'operations_admin'
                  ? [
                      { label: 'Registered Customers', value: customerCount },
                      { label: 'Total Sellers', value: sellers.length },
                      { label: 'Active Sellers', value: sellers.filter((s) => s.accountStatus === 'active').length },
                      { label: 'Pending Payout Verif.', value: sellers.filter((s) => s.payoutVerification === 'pending').length },
                      { label: 'Total Orders', value: orders.length },
                      { label: isLive ? 'GMV' : 'GMV (Demo)', value: formatINR(gmv) },
                      { label: `Commission (${settings.commissionRate}%)`, value: formatINR(commissionRevenue) },
                    ]
                  : [
                      { label: 'Registered Customers', value: customerCount },
                      { label: 'Total Sellers', value: sellers.length },
                      { label: 'Active Sellers', value: sellers.filter((s) => s.accountStatus === 'active').length },
                      { label: 'Pending Payout Verif.', value: sellers.filter((s) => s.payoutVerification === 'pending').length },
                      { label: 'Total Products', value: submissions.length },
                      { label: 'Published Products', value: submissions.filter((p) => p.status === 'published').length },
                      { label: 'Pending Approvals', value: submissions.filter((p) => p.status === 'pending_review').length },
                      { label: 'Total Orders', value: orders.length },
                      { label: isLive ? 'GMV' : 'GMV (Demo)', value: formatINR(gmv) },
                      { label: `Commission (${settings.commissionRate}%)`, value: formatINR(commissionRevenue) },
                    ]
              ).map((stat) => (
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
                        <p className="text-xs text-[#777168] capitalize">
                          {s.ownerName} · {s.location} · Email:{' '}
                          <strong>{s.emailVerified ? 'Verified' : 'Pending'}</strong> · Account:{' '}
                          <strong>{s.accountStatus.replace(/_/g, ' ')}</strong> · Payout:{' '}
                          <strong>{s.payoutVerification}</strong>
                        </p>
                        <p className="text-[11px] text-[#777168] mt-1 tabular-nums">
                          {s.productCount} products · {s.orderCount} orders
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {s.accountStatus === 'pending_approval' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSellerStatus(s.id, 'active')}
                              className="px-3 py-1.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider"
                            >
                              Approve & Activate
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSellerStatus(s.id, 'rejected')}
                              className="px-3 py-1.5 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-wider"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {s.accountStatus === 'active' && (
                          <button
                            type="button"
                            onClick={() => handleSellerStatus(s.id, 'suspended')}
                            className="px-3 py-1.5 border border-[#25231F] text-xs uppercase tracking-wider text-[#25231F]"
                          >
                            Suspend
                          </button>
                        )}
                        {(s.accountStatus === 'suspended' || s.accountStatus === 'rejected') && (
                          <button
                            type="button"
                            onClick={() => handleSellerStatus(s.id, 'active')}
                            className="px-3 py-1.5 border border-[#25231F] text-xs uppercase tracking-wider text-[#25231F]"
                          >
                            Activate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSellerPayout(s.id, 'verified')}
                          className="px-3 py-1.5 bg-[#78816A] text-[#FAF9F6] text-xs uppercase tracking-wider"
                        >
                          Verify Payout
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
                      <div className="flex items-center gap-2">
                        {p.isFeatured && (
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-[#78816A] text-[#FAF9F6]">
                            Featured
                          </span>
                        )}
                        <span className="text-xs uppercase tracking-wider px-2.5 py-1 bg-[#F2EDE4] border border-[#D8CBB9]">
                          {p.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-[#777168]">
                      Seller: {p.sellerName}
                      {p.sellerStatus && p.sellerStatus !== 'active'
                        ? ` (${p.sellerStatus.replace(/_/g, ' ')})`
                        : ''}{' '}
                      · {p.community} · {p.material} · {p.productionMethod} · {formatINR(p.price)}
                    </p>
                    <div className="pt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleModerateProduct(p.id, 'published', p.isFeatured)}
                        className="px-4 py-2 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider"
                      >
                        Approve & Publish
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleFeatured(p.id, !p.isFeatured)}
                        className="px-3.5 py-2 border border-[#D8CBB9] bg-[#F2EDE4] text-xs uppercase tracking-wider text-[#25231F]"
                      >
                        {p.isFeatured ? 'Unfeature' : 'Mark Featured'}
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
                .map((o) => {
                  const canCancel = canAdminCancelOrder(o);
                  return (
                    <div key={o.id} className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-2">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-medium text-sm tabular-nums text-[#25231F]">{o.orderNumber}</span>
                        <span className="text-xs uppercase tracking-wider text-[#78816A]">
                          {o.orderStatus.replace(/_/g, ' ')} · {o.paymentMethod} · {o.paymentStatus.replace(/_/g, ' ')}
                        </span>
                        <span className="font-medium text-sm tabular-nums">{formatINR(o.total)}</span>
                      </div>
                      <p className="text-xs text-[#777168]">Customer: {o.customerName}</p>
                      <div className="pt-2 border-t border-[#E6DED2] text-xs text-[#514B43] space-y-1">
                        {o.sellerOrders.map((so, i) => (
                          <p key={so.id || i}>
                            Seller Fulfilment: <strong>{so.sellerName}</strong> —{' '}
                            {so.fulfilmentStatus.replace(/_/g, ' ')} ({formatINR(so.subtotal)})
                            {so.codReconciliationStatus && so.codReconciliationStatus !== 'not_applicable'
                              ? ` · COD: ${so.codReconciliationStatus.replace(/_/g, ' ')}`
                              : ''}
                          </p>
                        ))}
                      </div>
                      {(canCancel || (o.paymentMethod === 'Online' && ['paid', 'captured', 'partially_refunded'].includes(o.paymentStatus) && canAccessAdminTab(adminRole, 'refunds'))) && (
                        <div className="pt-2 flex flex-wrap gap-2">
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => handleAdminCancelOrder(o.id)}
                              className="px-3.5 py-1.5 border border-[#A65F46] text-[#A65F46] text-xs uppercase tracking-wider hover:bg-[#A65F46] hover:text-[#FAF9F6] transition-colors"
                            >
                              Cancel Order & Restore Stock
                            </button>
                          )}
                          {o.paymentMethod === 'Online' &&
                            ['paid', 'captured', 'partially_refunded'].includes(o.paymentStatus) &&
                            canAccessAdminTab(adminRole, 'refunds') && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOnlineRefundForm((prev) => ({
                                    ...prev,
                                    orderId: o.id,
                                    sellerOrderId: '',
                                    amountInr: String(o.total),
                                  }));
                                  setActiveTab('refunds');
                                }}
                                className="px-3.5 py-1.5 border border-[#25231F] text-[#25231F] text-xs uppercase tracking-wider hover:bg-[#25231F] hover:text-[#FAF9F6] transition-colors"
                              >
                                Issue Online Refund
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* REFUNDS & COD (Super Admin & Operations Admin ONLY) */}
          {activeTab === 'refunds' && canAccessAdminTab(adminRole, 'refunds') && (
            <div className="space-y-8">
              {/* Filter Bar */}
              <div className="p-5 bg-[#FAF9F6] border border-[#D8CBB9] flex flex-wrap items-center gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#777168] mb-1">
                    Payment Channel
                  </label>
                  <select
                    value={refundChannelFilter}
                    onChange={(e) =>
                      setRefundChannelFilter(e.target.value as 'all' | 'razorpay' | 'cod_manual')
                    }
                    className="px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="all">All Channels</option>
                    <option value="razorpay">Online (Razorpay)</option>
                    <option value="cod_manual">COD Manual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#777168] mb-1">
                    Refund State
                  </label>
                  <select
                    value={refundStatusFilter}
                    onChange={(e) =>
                      setRefundStatusFilter(
                        e.target.value as
                          | 'all'
                          | 'requested'
                          | 'approved'
                          | 'pending'
                          | 'processed'
                          | 'failed'
                          | 'rejected'
                      )
                    }
                    className="px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="all">All Statuses</option>
                    <option value="requested">Requested</option>
                    <option value="approved">Approved</option>
                    <option value="pending">Processing</option>
                    <option value="processed">Processed</option>
                    <option value="failed">Failed</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>

              {/* Refund Requests & Lifecycle Queue */}
              <div className="space-y-4">
                <h2 className="font-serif text-2xl text-[#25231F]">Refund Queue & Approvals</h2>
                {refunds.filter((rf) => {
                  if (refundChannelFilter !== 'all' && rf.refundChannel !== refundChannelFilter) {
                    return false;
                  }
                  if (refundStatusFilter === 'all') return true;
                  if (refundStatusFilter === 'processed' || refundStatusFilter === 'failed' || refundStatusFilter === 'pending') {
                    return rf.status === refundStatusFilter;
                  }
                  return rf.requestStatus === refundStatusFilter;
                }).length === 0 ? (
                  <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#777168]">
                    No refunds matching the selected filters.
                  </div>
                ) : (
                  refunds
                    .filter((rf) => {
                      if (refundChannelFilter !== 'all' && rf.refundChannel !== refundChannelFilter) {
                        return false;
                      }
                      if (refundStatusFilter === 'all') return true;
                      if (
                        refundStatusFilter === 'processed' ||
                        refundStatusFilter === 'failed' ||
                        refundStatusFilter === 'pending'
                      ) {
                        return rf.status === refundStatusFilter;
                      }
                      return rf.requestStatus === refundStatusFilter;
                    })
                    .map((rf) => (
                      <div key={rf.id} className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3">
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
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-sm tabular-nums text-[#25231F]">
                              {formatInrFromPaise(rf.amountPaise)}
                            </span>
                            <span className="text-xs uppercase tracking-wider px-2.5 py-1 bg-[#F2EDE4] border border-[#D8CBB9]">
                              {getRefundStatusLabel(rf.status, rf.requestStatus)}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-[#514B43]">Reason: {rf.reason}</p>
                        {rf.providerRefundId && (
                          <p className="text-xs text-[#777168] tabular-nums">
                            Razorpay Refund ID: {rf.providerRefundId}
                          </p>
                        )}
                        {rf.manualReference && (
                          <p className="text-xs text-[#777168] tabular-nums">
                            Manual Ref: {rf.manualReference} ({rf.refundMethod || 'transfer'})
                          </p>
                        )}
                        {rf.failureReason && (
                          <p className="text-xs text-[#A65F46]">Failure: {rf.failureReason}</p>
                        )}
                        {rf.internalNotes && (
                          <p className="text-xs text-[#777168]">Internal Note: {rf.internalNotes}</p>
                        )}

                        {rf.sellerAdjustments.length > 0 && (
                          <div className="pt-2 border-t border-[#E6DED2] text-xs text-[#514B43] space-y-1">
                            {rf.sellerAdjustments.map((adj) => (
                              <p key={adj.sellerOrderId} className="tabular-nums">
                                Seller <strong>{adj.sellerName || adj.sellerOrderId.slice(0, 8)}</strong>: Gross{' '}
                                {formatInrFromPaise(adj.grossRefundPaise)} · Commission Reversed{' '}
                                {formatInrFromPaise(adj.commissionReversedPaise)} · Payable Reversed{' '}
                                {formatInrFromPaise(adj.sellerPayableReversedPaise)}
                              </p>
                            ))}
                          </div>
                        )}

                        <div className="pt-2 border-t border-[#E6DED2] space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <input
                              type="text"
                              placeholder="Internal admin audit note (never shown to customer)..."
                              value={refundNoteDrafts[rf.id] || ''}
                              onChange={(e) =>
                                setRefundNoteDrafts((prev) => ({ ...prev, [rf.id]: e.target.value }))
                              }
                              className="flex-1 min-w-[200px] px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                            />
                            {rf.requestStatus === 'requested' && (
                              <input
                                type="text"
                                placeholder="Customer rejection reason (if rejecting)..."
                                value={refundRejectDrafts[rf.id] || ''}
                                onChange={(e) =>
                                  setRefundRejectDrafts((prev) => ({ ...prev, [rf.id]: e.target.value }))
                                }
                                className="flex-1 min-w-[200px] px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                              />
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {rf.requestStatus === 'requested' && (
                              <>
                                <button
                                  type="button"
                                  disabled={refundBusyId === rf.id}
                                  onClick={() => handleReviewRefund(rf.id, 'approved')}
                                  className="px-3.5 py-1.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                                >
                                  Approve Request
                                </button>
                                <button
                                  type="button"
                                  disabled={refundBusyId === rf.id}
                                  onClick={() => handleReviewRefund(rf.id, 'rejected')}
                                  className="px-3.5 py-1.5 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                                >
                                  Reject Request
                                </button>
                              </>
                            )}

                            {rf.refundChannel === 'razorpay' &&
                              (rf.requestStatus === 'approved' || rf.status === 'failed') && (
                                <button
                                  type="button"
                                  disabled={refundBusyId === rf.id}
                                  onClick={() => handleTriggerRazorpayRefund(rf)}
                                  className="px-3.5 py-1.5 bg-[#78816A] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                                >
                                  {rf.status === 'failed'
                                    ? 'Retry Razorpay Refund'
                                    : 'Initiate Razorpay Refund'}
                                </button>
                              )}

                            {rf.restockStatus === 'pending_inspection' && (
                              <>
                                <button
                                  type="button"
                                  disabled={refundBusyId === rf.id}
                                  onClick={() => handleApproveRestock(rf.id, 'restocked')}
                                  className="px-3.5 py-1.5 border border-[#78816A] text-[#78816A] text-xs uppercase tracking-wider disabled:opacity-60"
                                >
                                  Approve Return Restock
                                </button>
                                <button
                                  type="button"
                                  disabled={refundBusyId === rf.id}
                                  onClick={() => handleApproveRestock(rf.id, 'rejected_damaged')}
                                  className="px-3.5 py-1.5 border border-[#A65F46] text-[#A65F46] text-xs uppercase tracking-wider disabled:opacity-60"
                                >
                                  Mark Return Damaged
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>

              {/* Action Forms Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Initiate Online Refund */}
                <form
                  onSubmit={handleCreateOnlineRefund}
                  className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3"
                >
                  <h3 className="font-serif text-lg text-[#25231F]">Initiate Razorpay Refund</h3>
                  <select
                    value={onlineRefundForm.orderId}
                    onChange={(e) =>
                      setOnlineRefundForm((prev) => ({
                        ...prev,
                        orderId: e.target.value,
                        sellerOrderId: '',
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="">Select Online Order *</option>
                    {orders
                      .filter(
                        (o) =>
                          o.paymentMethod === 'Online' &&
                          ['paid', 'captured', 'partially_refunded'].includes(o.paymentStatus)
                      )
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.orderNumber} ({formatINR(o.total)})
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Refund Amount (INR — blank for full)"
                    value={onlineRefundForm.amountInr}
                    onChange={(e) =>
                      setOnlineRefundForm((prev) => ({ ...prev, amountInr: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs tabular-nums"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Shipping Refund (INR)"
                    value={onlineRefundForm.shippingInr}
                    onChange={(e) =>
                      setOnlineRefundForm((prev) => ({ ...prev, shippingInr: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs tabular-nums"
                  />
                  <input
                    type="text"
                    placeholder="Reason *"
                    value={onlineRefundForm.reason}
                    onChange={(e) =>
                      setOnlineRefundForm((prev) => ({ ...prev, reason: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Internal Admin Notes"
                    value={onlineRefundForm.internalNotes}
                    onChange={(e) =>
                      setOnlineRefundForm((prev) => ({ ...prev, internalNotes: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <button
                    type="submit"
                    disabled={refundBusyId === 'create-online'}
                    className="w-full py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest disabled:opacity-60"
                  >
                    Execute Online Refund
                  </button>
                </form>

                {/* COD Cancellation Accounting */}
                <form
                  onSubmit={handleCodCancellationAccounting}
                  className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3"
                >
                  <h3 className="font-serif text-lg text-[#25231F]">COD Cancellation Accounting</h3>
                  <select
                    value={codCancelForm.sellerOrderId}
                    onChange={(e) =>
                      setCodCancelForm((prev) => ({ ...prev, sellerOrderId: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="">Select COD Seller Order *</option>
                    {orders
                      .filter((o) => o.paymentMethod === 'COD')
                      .flatMap((o) =>
                        o.sellerOrders.map((so) => (
                          <option key={so.id} value={so.id}>
                            {o.orderNumber} · {so.sellerName} ({so.fulfilmentStatus})
                          </option>
                        ))
                      )}
                  </select>
                  <select
                    value={codCancelForm.stage}
                    onChange={(e) =>
                      setCodCancelForm((prev) => ({
                        ...prev,
                        stage: e.target.value as Exclude<
                          CodCancellationStage,
                          'manual_refund_after_collection'
                        >,
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="before_collection">Before Collection (Restore Stock)</option>
                    <option value="after_dispatch">After Dispatch (Pending Inspection)</option>
                    <option value="failed_delivery_rto">Failed Delivery / RTO (Pending Inspection)</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Courier / RTO Deduction (INR)"
                    value={codCancelForm.courierDeductionInr}
                    onChange={(e) =>
                      setCodCancelForm((prev) => ({
                        ...prev,
                        courierDeductionInr: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs tabular-nums"
                  />
                  <input
                    type="text"
                    placeholder="Courier Partner (optional)"
                    value={codCancelForm.courierName}
                    onChange={(e) =>
                      setCodCancelForm((prev) => ({ ...prev, courierName: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Cancellation Reason *"
                    value={codCancelForm.reason}
                    onChange={(e) =>
                      setCodCancelForm((prev) => ({ ...prev, reason: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <button
                    type="submit"
                    disabled={refundBusyId === 'cod-cancel'}
                    className="w-full py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest disabled:opacity-60"
                  >
                    Post COD Cancellation
                  </button>
                </form>

                {/* Manual COD Refund */}
                <form
                  onSubmit={handleRecordManualCodRefund}
                  className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3"
                >
                  <h3 className="font-serif text-lg text-[#25231F]">Record Manual COD Refund</h3>
                  <select
                    value={manualCodForm.sellerOrderId}
                    onChange={(e) => {
                      const soId = e.target.value;
                      const matched = codRecords.find((c) => c.sellerOrderId === soId);
                      const fallbackOrder = orders.find((o) =>
                        o.sellerOrders.some((so) => so.id === soId)
                      );
                      setManualCodForm((prev) => ({
                        ...prev,
                        sellerOrderId: soId,
                        orderId: matched?.orderId || fallbackOrder?.id || '',
                      }));
                    }}
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="">Select Collected COD Seller Order *</option>
                    {codRecords.map((rec) => (
                      <option key={rec.sellerOrderId} value={rec.sellerOrderId}>
                        {rec.orderNumber} · {rec.sellerName} (Collected{' '}
                        {formatInrFromPaise(rec.collectedAmountPaise)})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Manual Refund Amount (INR) *"
                    value={manualCodForm.amountInr}
                    onChange={(e) =>
                      setManualCodForm((prev) => ({ ...prev, amountInr: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs tabular-nums"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={manualCodForm.refundMethod}
                      onChange={(e) =>
                        setManualCodForm((prev) => ({ ...prev, refundMethod: e.target.value }))
                      }
                      className="px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                    >
                      <option value="upi">UPI</option>
                      <option value="bank_transfer">NEFT / IMPS</option>
                      <option value="cash">Cash Voucher</option>
                    </select>
                    <input
                      type="date"
                      value={manualCodForm.refundDate}
                      onChange={(e) =>
                        setManualCodForm((prev) => ({ ...prev, refundDate: e.target.value }))
                      }
                      className="px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs tabular-nums"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Transfer / UTR Reference ID *"
                    value={manualCodForm.manualReference}
                    onChange={(e) =>
                      setManualCodForm((prev) => ({ ...prev, manualReference: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Reason *"
                    value={manualCodForm.reason}
                    onChange={(e) =>
                      setManualCodForm((prev) => ({ ...prev, reason: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Internal Admin Notes"
                    value={manualCodForm.internalNotes}
                    onChange={(e) =>
                      setManualCodForm((prev) => ({ ...prev, internalNotes: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <button
                    type="submit"
                    disabled={refundBusyId === 'manual-cod'}
                    className="w-full py-2.5 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-widest disabled:opacity-60"
                  >
                    Record COD Refund
                  </button>
                </form>
              </div>

              {/* COD Collection Ledger Summary */}
              {codRecords.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-serif text-xl text-[#25231F]">COD Collection & Reconciliation Records</h3>
                  <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
                    {codRecords.map((rec) => (
                      <div key={rec.id} className="p-4 text-xs flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-medium text-[#25231F] tabular-nums">{rec.orderNumber}</span>
                          <span className="ml-2 text-[#514B43]">{rec.sellerName}</span>
                          <p className="text-[#777168] mt-0.5 capitalize">
                            Collection: {rec.collectionStatus.replace(/_/g, ' ')} · Reconciliation:{' '}
                            {rec.reconciliationStatus.replace(/_/g, ' ')}
                            {rec.cancellationStage ? ` · Stage: ${rec.cancellationStage.replace(/_/g, ' ')}` : ''}
                          </p>
                        </div>
                        <div className="text-right tabular-nums">
                          <p className="text-[#25231F]">
                            Collected: {formatInrFromPaise(rec.collectedAmountPaise)} /{' '}
                            {formatInrFromPaise(rec.codOrderValuePaise)}
                          </p>
                          <p className="text-[#A65F46]">
                            Refunded: {formatInrFromPaise(rec.refundedAmountPaise)} · Courier:{' '}
                            {formatInrFromPaise(rec.courierDeductionPaise)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Financial Ledger Audit Viewer */}
              <div className="space-y-3">
                <h3 className="font-serif text-xl text-[#25231F]">Financial Ledger Entries (Append-Only)</h3>
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

          {/* SELLER SETTLEMENTS & RAZORPAY ROUTE (Super Admin & Operations Admin ONLY) */}
          {activeTab === 'settlements' && canAccessAdminTab(adminRole, 'settlements') && (
            <div className="space-y-8">
              {/* Gateway & Approval Status Banner */}
              <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-3 pb-3 border-b border-[#E6DED2]">
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-[#777168]">
                      Razorpay Route Marketplace Settlement Control
                    </p>
                    <h2 className="font-serif text-2xl text-[#25231F] mt-0.5">
                      Linked Accounts, Transfers & Reconciliation
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider px-3 py-1 border border-[#D8CBB9] bg-[#F2EDE4] text-[#25231F]">
                      Route: {routeGateway.razorpayRouteEnabled ? 'Enabled' : 'Disabled'} ·{' '}
                      {routeGateway.routeApprovalStatus.replace(/_/g, ' ')}
                    </span>
                    <button
                      type="button"
                      disabled={settlementBusyId === 'reconcile'}
                      onClick={handleRunReconciliation}
                      className="px-4 py-1.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                    >
                      {settlementBusyId === 'reconcile' ? 'Reconciling...' : 'Run Route Reconciliation'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[#514B43]">
                  Razorpay Route remains <strong>disabled by default</strong> until official Razorpay Route onboarding is approved and enabled in server configuration. COD orders never execute Route transfers and continue settling on the Refunds &amp; COD ledger.
                </p>
              </div>

              {/* Onboarding Review & Linked Accounts */}
              <div className="space-y-4">
                <h3 className="font-serif text-xl text-[#25231F]">Seller Settlement Onboarding &amp; Linked Accounts</h3>
                {settlementAccounts.length === 0 ? (
                  <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#777168]">
                    No seller settlement onboarding records submitted yet.
                  </div>
                ) : (
                  settlementAccounts.map((acct) => (
                    <div key={acct.id} className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3">
                      <div className="flex flex-wrap justify-between gap-2 pb-3 border-b border-[#E6DED2]">
                        <div>
                          <h4 className="font-serif text-lg text-[#25231F]">
                            {acct.sellerName || acct.legalBusinessName}
                          </h4>
                          <p className="text-xs text-[#777168]">
                            Legal: {acct.legalBusinessName} ({acct.businessType}) · {acct.contactEmail} · {acct.contactPhone}
                          </p>
                        </div>
                        <span className="text-xs uppercase tracking-wider px-2.5 py-1 border border-[#D8CBB9] bg-[#F2EDE4] text-[#25231F]">
                          {acct.routeOnboardingStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
                        <div>
                          <p className="text-[10px] uppercase text-[#777168]">Masked PAN</p>
                          <p className="text-[#25231F] font-medium">******{acct.panLast4}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-[#777168]">Masked Bank &amp; IFSC</p>
                          <p className="text-[#25231F] font-medium">
                            XXXX-{acct.bankAccountLast4} · {acct.bankIfsc}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-[#777168]">Linked Account ID</p>
                          <p className="text-[#25231F] font-medium">
                            {acct.razorpayLinkedAccountId || 'Not created'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-[#777168]">KYC Vault Docs</p>
                          <p className="text-[#25231F] font-medium">
                            {acct.kycStoragePaths.length} private file(s)
                          </p>
                        </div>
                      </div>
                      {acct.rejectionReason && (
                        <p className="text-xs text-[#A65F46]">Note: {acct.rejectionReason}</p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-[#E6DED2]">
                        <input
                          type="text"
                          placeholder="Review note / clarification..."
                          value={onboardingReviewNotes[acct.id] || ''}
                          onChange={(e) =>
                            setOnboardingReviewNotes((p) => ({ ...p, [acct.id]: e.target.value }))
                          }
                          className="px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Transient PAN (only sent to Route)"
                          value={routePanInputs[acct.id] || ''}
                          onChange={(e) =>
                            setRoutePanInputs((p) => ({ ...p, [acct.id]: e.target.value.toUpperCase() }))
                          }
                          className="px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs uppercase"
                        />
                        <input
                          type="password"
                          placeholder="Transient Full Account # (not stored)"
                          value={routeBankInputs[acct.id] || ''}
                          onChange={(e) =>
                            setRouteBankInputs((p) => ({ ...p, [acct.id]: e.target.value }))
                          }
                          className="px-3 py-1.5 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={settlementBusyId === acct.id}
                          onClick={() => handleReviewOnboarding(acct.id, 'verification_pending')}
                          className="px-3 py-1.5 bg-[#78816A] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                        >
                          Mark Verification Pending
                        </button>
                        <button
                          type="button"
                          disabled={settlementBusyId === acct.id}
                          onClick={() => handleReviewOnboarding(acct.id, 'action_required')}
                          className="px-3 py-1.5 border border-[#A65F46] text-[#A65F46] text-xs uppercase tracking-wider disabled:opacity-60"
                        >
                          Action Required
                        </button>
                        <button
                          type="button"
                          disabled={settlementBusyId === acct.id}
                          onClick={() => handleReviewOnboarding(acct.id, 'rejected')}
                          className="px-3 py-1.5 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                        >
                          Reject KYC
                        </button>
                        <button
                          type="button"
                          disabled={settlementBusyId === `link-${acct.id}`}
                          onClick={() => handleCreateLinkedAccount(acct)}
                          className="px-3 py-1.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-wider disabled:opacity-60"
                        >
                          {acct.razorpayLinkedAccountId
                            ? 'Update / Sync Linked Account'
                            : 'Create Route Linked Account'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Create & Reverse Transfer Forms */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <form
                  onSubmit={handleCreateTransfer}
                  className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3"
                >
                  <h3 className="font-serif text-lg text-[#25231F]">Initiate Route Transfer (Online Only)</h3>
                  <select
                    value={transferForm.sellerOrderId}
                    onChange={(e) =>
                      setTransferForm((p) => ({ ...p, sellerOrderId: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="">Select Captured Online Seller Order *</option>
                    {orders
                      .filter(
                        (o) =>
                          o.paymentMethod === 'Online' &&
                          ['paid', 'captured', 'partially_refunded'].includes(o.paymentStatus)
                      )
                      .flatMap((o) =>
                        o.sellerOrders.map((so) => (
                          <option key={so.id} value={so.id}>
                            {o.orderNumber} · {so.sellerName} ({formatINR(so.subtotal)})
                          </option>
                        ))
                      )}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Transfer Amount (INR — blank for remaining payable)"
                    value={transferForm.amountInr}
                    onChange={(e) => setTransferForm((p) => ({ ...p, amountInr: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs tabular-nums"
                  />
                  <label className="flex items-center gap-2 text-xs text-[#514B43]">
                    <input
                      type="checkbox"
                      checked={transferForm.onHold}
                      onChange={(e) => setTransferForm((p) => ({ ...p, onHold: e.target.checked }))}
                      className="accent-[#A65F46]"
                    />
                    <span>Place settlement on hold (return window protection)</span>
                  </label>
                  <button
                    type="submit"
                    disabled={settlementBusyId === 'create-transfer'}
                    className="w-full py-2.5 bg-[#25231F] text-[#FAF9F6] text-xs uppercase tracking-widest disabled:opacity-60"
                  >
                    Create Route Transfer
                  </button>
                </form>

                <form
                  onSubmit={handleReverseTransfer}
                  className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] space-y-3"
                >
                  <h3 className="font-serif text-lg text-[#25231F]">Reverse Route Transfer</h3>
                  <select
                    value={reversalForm.transferId}
                    onChange={(e) => setReversalForm((p) => ({ ...p, transferId: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  >
                    <option value="">Select Reversible Route Transfer *</option>
                    {transfers
                      .filter((t) =>
                        ['created', 'processed', 'on_hold', 'partially_reversed'].includes(t.status)
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.orderNumber} · {t.sellerName || t.sellerId.slice(0, 8)} (
                          {formatInrFromPaise(t.amountPaise - t.reversedPaise)} reversible)
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Reversal Amount (INR — blank for full remaining)"
                    value={reversalForm.amountInr}
                    onChange={(e) => setReversalForm((p) => ({ ...p, amountInr: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs tabular-nums"
                  />
                  <input
                    type="text"
                    placeholder="Linked Refund ID (optional)"
                    value={reversalForm.refundId}
                    onChange={(e) => setReversalForm((p) => ({ ...p, refundId: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Reversal Reason *"
                    value={reversalForm.reason}
                    onChange={(e) => setReversalForm((p) => ({ ...p, reason: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#F2EDE4] border border-[#D8CBB9] text-xs"
                  />
                  <button
                    type="submit"
                    disabled={settlementBusyId === 'reverse-transfer'}
                    className="w-full py-2.5 bg-[#A65F46] text-[#FAF9F6] text-xs uppercase tracking-widest disabled:opacity-60"
                  >
                    Reverse Route Transfer
                  </button>
                </form>
              </div>

              {/* Route Transfers & Reversal Ledger */}
              <div className="space-y-3">
                <h3 className="font-serif text-xl text-[#25231F]">Seller Transfers &amp; Bank Settlements</h3>
                {transfers.length === 0 ? (
                  <div className="p-6 bg-[#FAF9F6] border border-[#D8CBB9] text-sm text-[#777168]">
                    No Razorpay Route transfers recorded yet.
                  </div>
                ) : (
                  <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
                    {transfers.map((tr) => (
                      <div key={tr.id} className="p-4 text-xs flex flex-wrap justify-between items-center gap-3">
                        <div>
                          <span className="font-medium text-[#25231F] tabular-nums">{tr.orderNumber}</span>
                          <span className="ml-2 text-[#514B43]">{tr.sellerName || tr.sellerId.slice(0, 8)}</span>
                          <p className="text-[#777168] mt-0.5 capitalize">
                            Transfer: {tr.status.replace(/_/g, ' ')} · Settlement:{' '}
                            {tr.settlementStatus.replace(/_/g, ' ')}
                            {tr.providerTransferId ? ` · ${tr.providerTransferId}` : ''}
                            {tr.settlementUtr ? ` · UTR: ${tr.settlementUtr}` : ''}
                          </p>
                          {tr.failureReason && (
                            <p className="text-[#A65F46] mt-0.5">{tr.failureReason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right tabular-nums">
                            <p className="font-medium text-[#25231F]">{formatInrFromPaise(tr.amountPaise)}</p>
                            {tr.reversedPaise > 0 && (
                              <p className="text-[#A65F46]">
                                Reversed: -{formatInrFromPaise(tr.reversedPaise)}
                              </p>
                            )}
                          </div>
                          {tr.status === 'failed' && (
                            <button
                              type="button"
                              disabled={settlementBusyId === `retry-${tr.id}`}
                              onClick={() => handleRetryTransfer(tr)}
                              className="px-3 py-1.5 border border-[#25231F] text-[#25231F] uppercase tracking-wider disabled:opacity-60"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(transferReversals.length > 0 || settlementRecords.length > 0 || reconciliationRuns.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <h3 className="font-serif text-lg text-[#25231F]">Transfer Reversals</h3>
                    <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
                      {transferReversals.length === 0 ? (
                        <p className="p-4 text-xs text-[#777168]">No transfer reversals recorded.</p>
                      ) : (
                        transferReversals.map((rv) => (
                          <div key={rv.id} className="p-3 text-xs flex justify-between">
                            <div>
                              <span className="font-medium text-[#25231F] uppercase">{rv.status}</span>
                              <p className="text-[#514B43]">{rv.reason}</p>
                              {rv.providerReversalId && (
                                <p className="text-[#777168] tabular-nums">{rv.providerReversalId}</p>
                              )}
                            </div>
                            <span className="tabular-nums font-medium text-[#A65F46]">
                              -{formatInrFromPaise(rv.amountPaise)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-serif text-lg text-[#25231F]">Reconciliation &amp; Settlement Runs</h3>
                    <div className="bg-[#FAF9F6] border border-[#D8CBB9] divide-y divide-[#E6DED2]">
                      {reconciliationRuns.map((rr) => (
                        <div key={rr.id} className="p-3 text-xs flex justify-between">
                          <div>
                            <span className="font-medium text-[#25231F]">{rr.runType}</span>
                            <p className="text-[#777168] capitalize">
                              {rr.status.replace(/_/g, ' ')} · Checked {rr.checkedCount} · Discrepancies{' '}
                              {rr.discrepancyCount}
                            </p>
                          </div>
                          <span className="text-[#777168] tabular-nums">
                            {new Date(rr.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                      {settlementRecords.map((sr) => (
                        <div key={sr.id} className="p-3 text-xs flex justify-between">
                          <div>
                            <span className="font-medium text-[#25231F]">{sr.providerSettlementId || sr.id}</span>
                            <p className="text-[#777168]">UTR: {sr.utr || 'Pending'} · {sr.status}</p>
                          </div>
                          <span className="tabular-nums font-medium text-[#78816A]">
                            {formatInrFromPaise(sr.amountPaise)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CUSTOMERS */}
          {activeTab === 'customers' && (
            <div className="bg-[#FAF9F6] border border-[#D8CBB9] p-6 space-y-3">
              <h2 className="font-serif text-xl text-[#25231F]">
                {isLive ? 'Registered Profiles' : 'Registered Customers (Demo)'}
              </h2>
              {isLive ? (
                <p className="text-sm text-[#514B43]">
                  Total registered member profiles in database: <strong className="tabular-nums">{customerCount}</strong>
                </p>
              ) : (
                <>
                  <p className="text-sm text-[#514B43]">Ananya Baruah · ananya@example.com · 1 Order · Active</p>
                  <p className="text-sm text-[#514B43]">Rohan Kalita · rohan@example.com · 1 Order · Active</p>
                </>
              )}
            </div>
          )}

          {/* COMMUNITIES */}
          {activeTab === 'communities' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {communities.map((c) => (
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
              <p className="text-sm text-[#777168] mt-2">
                {isLive
                  ? 'No active return requests or reported reviews.'
                  : 'No active return requests or reported reviews in Demo Mode.'}
              </p>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
