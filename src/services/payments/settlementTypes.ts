export type RouteApprovalStatus = 'not_approved' | 'pending_review' | 'approved' | 'suspended';

export type SellerRouteOnboardingStatus =
  | 'not_started'
  | 'submitted'
  | 'verification_pending'
  | 'action_required'
  | 'active'
  | 'rejected'
  | 'suspended';

export type RouteTransferStatus =
  | 'pending'
  | 'created'
  | 'on_hold'
  | 'processed'
  | 'failed'
  | 'reversed'
  | 'partially_reversed';

export type RouteSettlementStatus =
  | 'pending'
  | 'scheduled'
  | 'on_hold'
  | 'settled'
  | 'failed'
  | 'reversed';

export interface RouteRegisteredAddress {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface SellerSettlementAccount {
  id: string;
  sellerId: string;
  sellerName?: string;
  legalBusinessName: string;
  businessType: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  panLast4: string;
  gstin?: string | null;
  beneficiaryName: string;
  bankAccountLast4: string;
  bankIfsc: string;
  settlementDestinationType: 'bank_account' | 'upi_vpa';
  registeredAddress?: RouteRegisteredAddress | null;
  kycStoragePaths: string[];
  kycStatus: SellerRouteOnboardingStatus;
  routeOnboardingStatus: SellerRouteOnboardingStatus;
  payoutsEnabled: boolean;
  razorpayLinkedAccountId?: string | null;
  razorpayProductId?: string | null;
  razorpayRawActivationStatus?: string | null;
  kycRequirements?: Array<Record<string, unknown>>;
  rejectionReason?: string | null;
  sellerConsentAccepted: boolean;
  agreementAccepted: boolean;
  agreementVersion?: string | null;
  lastSyncedAt?: string | null;
  updatedAt: string;
}

export interface SellerSettlementOnboardingInput {
  legalBusinessName: string;
  businessType: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  panLast4: string;
  gstin?: string;
  beneficiaryName: string;
  bankAccountLast4: string;
  bankIfsc: string;
  settlementDestinationType?: 'bank_account' | 'upi_vpa';
  registeredAddress: RouteRegisteredAddress;
  kycStoragePaths: string[];
  sellerConsentAccepted: boolean;
  agreementAccepted: boolean;
  agreementVersion?: string;
}

export interface SellerSettlementSummary {
  sellerId: string;
  grossSalesPaise: number;
  commissionPaise: number;
  refundDeductionsPaise: number;
  sellerPayablePaise: number;
  pendingTransfersPaise: number;
  settledPaise: number;
  failedTransfersPaise: number;
  reversedTransfersPaise: number;
  codCollectedPaise: number;
  codRemittedPaise: number;
  codOutstandingPaise: number;
}

export interface SellerTransferItem {
  id: string;
  sellerOrderId: string;
  orderId: string;
  orderNumber: string;
  sellerId: string;
  sellerName?: string;
  providerTransferId?: string | null;
  amountPaise: number;
  reversedPaise: number;
  status: RouteTransferStatus;
  settlementStatus: RouteSettlementStatus;
  onHold: boolean;
  holdUntil?: string | null;
  settlementId?: string | null;
  settlementUtr?: string | null;
  failureReason?: string | null;
  retryCount: number;
  createdAt: string;
  settledAt?: string | null;
}

export interface SellerSettlementPayoutRecord {
  id: string;
  sellerId: string;
  sellerTransferId?: string | null;
  providerSettlementId?: string | null;
  utr?: string | null;
  amountPaise: number;
  status: 'pending' | 'processed' | 'settled' | 'failed';
  settledAt?: string | null;
  createdAt: string;
}

export interface AdminRouteGatewayState {
  razorpayRouteEnabled: boolean;
  routeApprovalStatus: RouteApprovalStatus;
  onlinePaymentsEnabled: boolean;
  razorpayMode: 'test' | 'live';
}

export interface AdminTransferReversalItem {
  id: string;
  sellerTransferId: string;
  sellerOrderId: string;
  orderId: string;
  refundId?: string | null;
  providerReversalId?: string | null;
  amountPaise: number;
  status: 'pending' | 'processed' | 'failed';
  reason: string;
  failureReason?: string | null;
  createdAt: string;
  processedAt?: string | null;
}

export interface AdminReconciliationRun {
  id: string;
  runType: string;
  status: string;
  checkedCount: number;
  discrepancyCount: number;
  summary: Record<string, unknown>;
  createdAt: string;
  completedAt?: string | null;
}

export const DEFAULT_PAYMENT_GATEWAY_CONFIG = {
  onlinePaymentsEnabled: false,
  razorpayRouteEnabled: false,
  routeApprovalStatus: 'not_approved' as RouteApprovalStatus,
  commissionBasisPoints: 1200,
  commissionAppliesToShipping: false,
  commissionAppliesToTax: false,
} as const;

export interface RouteGatewayCheckInput {
  razorpayRouteEnabled: boolean;
  routeApprovalStatus: RouteApprovalStatus;
}

export interface RouteSellerAccountCheckInput {
  route_onboarding_status?: SellerRouteOnboardingStatus;
  routeOnboardingStatus?: SellerRouteOnboardingStatus;
  payouts_enabled?: boolean;
  payoutsEnabled?: boolean;
  razorpay_linked_account_id?: string | null;
  razorpayLinkedAccountId?: string | null;
}

export function isRouteTransferEligible(
  gateway: RouteGatewayCheckInput,
  account: RouteSellerAccountCheckInput | null | undefined
): boolean {
  if (!gateway.razorpayRouteEnabled || gateway.routeApprovalStatus !== 'approved') {
    return false;
  }
  if (!account) {
    return false;
  }
  const status = account.route_onboarding_status ?? account.routeOnboardingStatus;
  const payoutsEnabled = account.payouts_enabled ?? account.payoutsEnabled ?? false;
  const linkedAccountId = account.razorpay_linked_account_id ?? account.razorpayLinkedAccountId ?? '';
  return status === 'active' && payoutsEnabled === true && linkedAccountId.trim().length > 0;
}

