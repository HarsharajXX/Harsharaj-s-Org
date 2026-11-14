import type {
  RazorpayLinkedAccountEntity,
  RazorpayOrderEntity,
  RazorpayPaymentEntity,
  RazorpayRefundEntity,
  RazorpayRouteApiClient,
  RazorpayRouteProductEntity,
  RazorpaySettlementEntity,
  RazorpayTransferEntity,
  RazorpayTransferReversalEntity,
} from './types.ts';

export class RazorpayApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 502, code = 'RAZORPAY_API_ERROR') {
    super(message);
    this.name = 'RazorpayApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class HttpRazorpayClient implements RazorpayRouteApiClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly baseUrlV2: string;

  constructor(keyId: string, keySecret: string, baseUrl = 'https://api.razorpay.com/v1') {
    if (!keyId || !keySecret) {
      throw new Error('Server-side RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required.');
    }
    this.authHeader = `Basic ${btoa(`${keyId}:${keySecret}`)}`;
    this.baseUrl = baseUrl;
    this.baseUrlV2 = baseUrl.endsWith('/v1')
      ? `${baseUrl.slice(0, -3)}/v2`
      : 'https://api.razorpay.com/v2';
  }

  async createOrder(params: {
    amountPaise: number;
    currency: 'INR';
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrderEntity> {
    if (!Number.isSafeInteger(params.amountPaise) || params.amountPaise <= 0) {
      throw new RazorpayApiError('Order amount in paise must be a positive integer.', 400, 'INVALID_AMOUNT');
    }

    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: params.currency,
        receipt: params.receipt,
        payment_capture: 1,
        notes: params.notes,
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to create Razorpay order.',
        res.status,
        rpError?.code || 'RAZORPAY_CREATE_ORDER_FAILED'
      );
    }

    return payload as RazorpayOrderEntity;
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPaymentEntity> {
    const cleanId = paymentId.trim();
    if (!cleanId) {
      throw new RazorpayApiError('Missing Razorpay payment ID.', 400, 'INVALID_PAYMENT_ID');
    }

    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
      },
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to fetch payment details from Razorpay.',
        res.status,
        rpError?.code || 'RAZORPAY_FETCH_PAYMENT_FAILED'
      );
    }

    return payload as RazorpayPaymentEntity;
  }

  async fetchOrderPayments(providerOrderId: string): Promise<RazorpayPaymentEntity[]> {
    const cleanId = providerOrderId.trim();
    if (!cleanId) {
      throw new RazorpayApiError('Missing Razorpay order ID.', 400, 'INVALID_ORDER_ID');
    }

    const res = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(cleanId)}/payments`, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
      },
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to fetch order payments from Razorpay.',
        res.status,
        rpError?.code || 'RAZORPAY_FETCH_ORDER_PAYMENTS_FAILED'
      );
    }

    const items = (payload as { items?: unknown }).items;
    return Array.isArray(items) ? (items as RazorpayPaymentEntity[]) : [];
  }

  async createRefund(
    paymentId: string,
    params: {
      amountPaise: number;
      speed?: 'normal' | 'optimum';
      receipt?: string;
      notes?: Record<string, string>;
    }
  ): Promise<RazorpayRefundEntity> {
    const cleanPaymentId = paymentId.trim();
    if (!cleanPaymentId) {
      throw new RazorpayApiError('Missing Razorpay payment ID for refund.', 400, 'INVALID_PAYMENT_ID');
    }
    if (!Number.isSafeInteger(params.amountPaise) || params.amountPaise <= 0) {
      throw new RazorpayApiError('Refund amount in paise must be a positive integer.', 400, 'INVALID_REFUND_AMOUNT');
    }

    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(cleanPaymentId)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        speed: params.speed ?? 'normal',
        ...(params.receipt ? { receipt: params.receipt } : {}),
        ...(params.notes ? { notes: params.notes } : {}),
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to create Razorpay refund.',
        res.status,
        rpError?.code || 'RAZORPAY_CREATE_REFUND_FAILED'
      );
    }

    return payload as RazorpayRefundEntity;
  }

  async fetchRefund(refundId: string): Promise<RazorpayRefundEntity> {
    const cleanId = refundId.trim();
    if (!cleanId) {
      throw new RazorpayApiError('Missing Razorpay refund ID.', 400, 'INVALID_REFUND_ID');
    }

    const res = await fetch(`${this.baseUrl}/refunds/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
      },
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to fetch refund details from Razorpay.',
        res.status,
        rpError?.code || 'RAZORPAY_FETCH_REFUND_FAILED'
      );
    }

    return payload as RazorpayRefundEntity;
  }

  async createLinkedAccount(params: {
    email: string;
    phone: string;
    legalBusinessName: string;
    businessType: string;
    contactName: string;
    referenceId: string;
    pan?: string;
    gstin?: string;
    registeredAddress?: Record<string, unknown> | null;
  }): Promise<RazorpayLinkedAccountEntity> {
    const res = await fetch(`${this.baseUrlV2}/accounts`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: params.email,
        phone: params.phone,
        type: 'route',
        reference_id: params.referenceId,
        legal_business_name: params.legalBusinessName,
        business_type: params.businessType,
        contact_name: params.contactName,
        profile: {
          category: 'ecommerce',
          subcategory: 'apparel_and_accessories',
          ...(params.registeredAddress ? { addresses: { registered: params.registeredAddress } } : {}),
        },
        ...(params.pan || params.gstin
          ? {
              legal_info: {
                ...(params.pan ? { pan: params.pan } : {}),
                ...(params.gstin ? { gst: params.gstin } : {}),
              },
            }
          : {}),
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to create Razorpay Linked Account.',
        res.status,
        rpError?.code || 'RAZORPAY_CREATE_LINKED_ACCOUNT_FAILED'
      );
    }
    return payload as RazorpayLinkedAccountEntity;
  }

  async updateLinkedAccount(
    accountId: string,
    params: {
      email?: string;
      phone?: string;
      legalBusinessName?: string;
      contactName?: string;
      pan?: string;
      gstin?: string;
    }
  ): Promise<RazorpayLinkedAccountEntity> {
    const res = await fetch(`${this.baseUrlV2}/accounts/${encodeURIComponent(accountId.trim())}`, {
      method: 'PATCH',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(params.email ? { email: params.email } : {}),
        ...(params.phone ? { phone: params.phone } : {}),
        ...(params.legalBusinessName ? { legal_business_name: params.legalBusinessName } : {}),
        ...(params.contactName ? { contact_name: params.contactName } : {}),
        ...(params.pan || params.gstin
          ? {
              legal_info: {
                ...(params.pan ? { pan: params.pan } : {}),
                ...(params.gstin ? { gst: params.gstin } : {}),
              },
            }
          : {}),
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to update Razorpay Linked Account.',
        res.status,
        rpError?.code || 'RAZORPAY_UPDATE_LINKED_ACCOUNT_FAILED'
      );
    }
    return payload as RazorpayLinkedAccountEntity;
  }

  async fetchLinkedAccount(accountId: string): Promise<RazorpayLinkedAccountEntity> {
    const res = await fetch(`${this.baseUrlV2}/accounts/${encodeURIComponent(accountId.trim())}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader },
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to fetch Razorpay Linked Account.',
        res.status,
        rpError?.code || 'RAZORPAY_FETCH_LINKED_ACCOUNT_FAILED'
      );
    }
    return payload as RazorpayLinkedAccountEntity;
  }

  async requestRouteProduct(
    accountId: string,
    params: { tncAccepted: boolean }
  ): Promise<RazorpayRouteProductEntity> {
    const res = await fetch(
      `${this.baseUrlV2}/accounts/${encodeURIComponent(accountId.trim())}/products`,
      {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product_name: 'route',
          tnc_accepted: params.tncAccepted,
        }),
      }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to request Razorpay Route product.',
        res.status,
        rpError?.code || 'RAZORPAY_REQUEST_ROUTE_PRODUCT_FAILED'
      );
    }
    return payload as RazorpayRouteProductEntity;
  }

  async updateRouteProduct(
    accountId: string,
    productId: string,
    params: {
      accountNumber?: string;
      ifscCode?: string;
      beneficiaryName?: string;
      tncAccepted?: boolean;
    }
  ): Promise<RazorpayRouteProductEntity> {
    const res = await fetch(
      `${this.baseUrlV2}/accounts/${encodeURIComponent(accountId.trim())}/products/${encodeURIComponent(productId.trim())}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(params.accountNumber && params.ifscCode && params.beneficiaryName
            ? {
                settlements: {
                  account_number: params.accountNumber,
                  ifsc_code: params.ifscCode,
                  beneficiary_name: params.beneficiaryName,
                },
              }
            : {}),
          ...(typeof params.tncAccepted === 'boolean' ? { tnc_accepted: params.tncAccepted } : {}),
        }),
      }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to update Razorpay Route product settlement bank.',
        res.status,
        rpError?.code || 'RAZORPAY_UPDATE_ROUTE_PRODUCT_FAILED'
      );
    }
    return payload as RazorpayRouteProductEntity;
  }

  async fetchRouteProduct(accountId: string, productId: string): Promise<RazorpayRouteProductEntity> {
    const res = await fetch(
      `${this.baseUrlV2}/accounts/${encodeURIComponent(accountId.trim())}/products/${encodeURIComponent(productId.trim())}`,
      {
        method: 'GET',
        headers: { Authorization: this.authHeader },
      }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to fetch Razorpay Route product.',
        res.status,
        rpError?.code || 'RAZORPAY_FETCH_ROUTE_PRODUCT_FAILED'
      );
    }
    return payload as RazorpayRouteProductEntity;
  }

  async createPaymentTransfers(
    paymentId: string,
    transfers: Array<{
      account: string;
      amountPaise: number;
      onHold?: boolean;
      onHoldUntil?: number;
      notes?: Record<string, string>;
      linkedAccountNotes?: string[];
    }>
  ): Promise<RazorpayTransferEntity[]> {
    const cleanId = paymentId.trim();
    if (!cleanId || transfers.length === 0) {
      throw new RazorpayApiError('Payment ID and transfer instructions are required.', 400, 'INVALID_TRANSFER');
    }
    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(cleanId)}/transfers`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transfers: transfers.map((t) => ({
          account: t.account,
          amount: t.amountPaise,
          currency: 'INR',
          on_hold: Boolean(t.onHold),
          ...(t.onHold && t.onHoldUntil ? { on_hold_until: t.onHoldUntil } : {}),
          ...(t.notes ? { notes: t.notes } : {}),
          ...(t.linkedAccountNotes ? { linked_account_notes: t.linkedAccountNotes } : {}),
        })),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to create Razorpay Route transfer.',
        res.status,
        rpError?.code || 'RAZORPAY_CREATE_TRANSFER_FAILED'
      );
    }
    const items = (payload as { items?: unknown }).items;
    return Array.isArray(items) ? (items as RazorpayTransferEntity[]) : [payload as RazorpayTransferEntity];
  }

  async fetchTransfer(transferId: string): Promise<RazorpayTransferEntity> {
    const res = await fetch(`${this.baseUrl}/transfers/${encodeURIComponent(transferId.trim())}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader },
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to fetch Razorpay transfer.',
        res.status,
        rpError?.code || 'RAZORPAY_FETCH_TRANSFER_FAILED'
      );
    }
    return payload as RazorpayTransferEntity;
  }

  async reverseTransfer(
    transferId: string,
    params: { amountPaise: number; notes?: Record<string, string> }
  ): Promise<RazorpayTransferReversalEntity> {
    if (!Number.isSafeInteger(params.amountPaise) || params.amountPaise <= 0) {
      throw new RazorpayApiError('Reversal amount must be a positive integer in paise.', 400, 'INVALID_REVERSAL');
    }
    const res = await fetch(
      `${this.baseUrl}/transfers/${encodeURIComponent(transferId.trim())}/reversals`,
      {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: params.amountPaise,
          ...(params.notes ? { notes: params.notes } : {}),
        }),
      }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to reverse Razorpay transfer.',
        res.status,
        rpError?.code || 'RAZORPAY_REVERSE_TRANSFER_FAILED'
      );
    }
    return payload as RazorpayTransferReversalEntity;
  }

  async fetchSettlement(settlementId: string): Promise<RazorpaySettlementEntity> {
    const res = await fetch(
      `${this.baseUrl}/settlements/${encodeURIComponent(settlementId.trim())}`,
      {
        method: 'GET',
        headers: { Authorization: this.authHeader },
      }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rpError = (payload as { error?: { code?: string; description?: string } })?.error;
      throw new RazorpayApiError(
        rpError?.description || 'Failed to fetch Razorpay settlement.',
        res.status,
        rpError?.code || 'RAZORPAY_FETCH_SETTLEMENT_FAILED'
      );
    }
    return payload as RazorpaySettlementEntity;
  }
}

