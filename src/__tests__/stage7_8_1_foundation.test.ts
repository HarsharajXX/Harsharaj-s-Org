/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNonNegativeSafeInteger,
  calculateCommissionPaise,
  inrToPaise,
  paiseToInr,
} from '../services/payments/paymentTypes.ts';
import {
  assertPaymentMethodStatusCompatibility,
  isCodCashCollected,
  isOnlinePaymentRetryable,
  isOnlinePaymentSettled,
} from '../services/payments/paymentStatus.ts';
import {
  DEFAULT_PAYMENT_GATEWAY_CONFIG,
  isRouteTransferEligible,
} from '../services/payments/settlementTypes.ts';
import { getPaymentProvider } from '../services/payments/paymentProvider.ts';
import { OnlinePaymentsNotEnabledError } from '../services/payments/razorpayProvider.ts';

const repoRoot = process.cwd();
const migration008 = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/008_payment_and_settlement_foundation.sql'),
  'utf8'
);

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

test('1. Migration 008 is transactional, precondition-checked, and does not recreate payments', () => {
  assert.match(migration008, /^\s*--[\s\S]*?\nbegin;/m);
  assert.match(migration008, /commit;\s*$/);
  assert.match(migration008, /to_regclass\('public\.orders'\) is null/);
  assert.match(migration008, /to_regclass\('public\.payments'\) is null/);
  assert.match(migration008, /to_regprocedure\('public\.internal_restore_seller_order_inventory\(uuid\)'\) is null/);

  // Must alter existing public.payments rather than duplicating create table public.payments
  assert.doesNotMatch(migration008, /create table(?: if not exists)? public\.payments\b/i);
  assert.match(migration008, /alter table public\.payments\b/i);
});

test('2. Migration 008 defaults Razorpay Route and online payments to disabled', () => {
  assert.match(migration008, /online_payments_enabled boolean not null default false/);
  assert.match(migration008, /razorpay_route_enabled boolean not null default false/);
  assert.match(migration008, /route_approval_status text not null default 'not_approved'/);
  assert.match(migration008, /commission_basis_points integer not null default 1200/);
  assert.match(migration008, /commission_applies_to_shipping boolean not null default false/);
  assert.match(migration008, /commission_applies_to_tax boolean not null default false/);
});

test('3. Migration 008 enforces append-only ledger, COD guards, and seller settlement guards', () => {
  assert.match(
    migration008,
    /create trigger on_guard_financial_ledger_immutable\s+before update or delete on public\.financial_ledger_entries/
  );
  assert.match(migration008, /financial_ledger_entries is append-only/);

  assert.match(
    migration008,
    /COD cannot be marked collected without a positive collected_amount_paise/
  );
  assert.match(
    migration008,
    /COD cannot be marked remitted without remittance_reference and remittance_date/
  );
  assert.match(
    migration008,
    /Only authorized operations administrators or server settlement functions can activate KYC or Razorpay Route linked accounts/
  );
  assert.match(
    migration008,
    /new\.subtotal_paise is distinct from old\.subtotal_paise[\s\S]*new\.outstanding_balance_paise is distinct from old\.outstanding_balance_paise/
  );
});

test('4. Migration 008 isolates all financial and settlement tables from content_admin and anon', () => {
  const securedTables = [
    'payment_gateway_config',
    'payment_attempts',
    'payment_webhook_events',
    'seller_settlement_accounts',
    'seller_transfers',
    'settlement_records',
    'refund_records',
    'cod_collection_records',
    'financial_ledger_entries',
    'reconciliation_runs',
  ];

  for (const table of securedTables) {
    assert.match(migration008, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration008, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`));
    assert.match(migration008, new RegExp(`grant all on public\\.${table} to service_role;`));
  }

  assert.doesNotMatch(migration008, /\bis_admin\s*\(/);
  assert.doesNotMatch(migration008, /\bis_content_admin\s*\(/);
});

test('5. Online inventory reservation and expiry helpers are service_role-only and exact-once', () => {
  assert.match(
    migration008,
    /revoke all on function public\.reserve_online_order_inventory\(uuid, jsonb, jsonb, text, integer\) from public, anon, authenticated;\s*grant execute on function public\.reserve_online_order_inventory\(uuid, jsonb, jsonb, text, integer\) to service_role;/
  );
  assert.match(
    migration008,
    /revoke all on function public\.release_expired_online_order_inventory\(uuid, text\) from public, anon, authenticated;\s*grant execute on function public\.release_expired_online_order_inventory\(uuid, text\) to service_role;/
  );
  assert.match(migration008, /and o\.reservation_released_at is null[\s\S]*for update of o skip locked/);
  assert.match(migration008, /perform public\.internal_restore_seller_order_inventory\(v_so\.id\);/);
  assert.match(migration008, /if p_payment_method = 'online' then[\s\S]*Direct client online checkout is disabled/);
});

test('6. Integer paise conversion and 12% subtotal-only commission math work accurately', () => {
  assert.equal(inrToPaise(2499.5), 249950);
  assert.equal(inrToPaise(0), 0);
  assert.equal(paiseToInr(249950), 2499.5);
  assert.throws(() => assertNonNegativeSafeInteger(12.5), /safe integer/);
  assert.throws(() => assertNonNegativeSafeInteger(-100), /safe integer/);

  const breakdown = calculateCommissionPaise({
    subtotalPaise: 320000, // INR 3,200.00
    shippingPaise: 25000, // INR 250.00 (must NOT be commissioned)
    taxPaise: 16000, // INR 160.00 (must NOT be commissioned)
    commissionRateBps: 1200, // 12%
  });

  assert.equal(breakdown.commissionPaise, 38400); // 12% of 320000 = 38400 paise (INR 384)
  assert.equal(breakdown.sellerPayablePaise, 281600); // 320000 - 38400 = 281600 paise
  assert.equal(breakdown.commissionPaise + breakdown.sellerPayablePaise, breakdown.subtotalPaise);
});

test('7. Online payment statuses and COD lifecycle statuses remain strictly separated', () => {
  assert.equal(isOnlinePaymentSettled('captured'), true);
  assert.equal(isOnlinePaymentSettled('authorized'), false);
  assert.equal(isOnlinePaymentRetryable('failed'), true);
  assert.equal(isOnlinePaymentRetryable('expired'), false);
  assert.equal(isCodCashCollected('delivered'), false);
  assert.equal(isCodCashCollected('collected'), true);
  assert.equal(isCodCashCollected('remitted'), true);

  assert.doesNotThrow(() =>
    assertPaymentMethodStatusCompatibility('online', 'captured', 'not_applicable')
  );
  assert.doesNotThrow(() =>
    assertPaymentMethodStatusCompatibility('cod', 'cod_pending', 'confirmed')
  );
  assert.throws(() =>
    assertPaymentMethodStatusCompatibility('online', 'created', 'confirmed')
  );
  assert.throws(() =>
    assertPaymentMethodStatusCompatibility('cod', 'captured', 'delivered')
  );
  assert.throws(() =>
    assertPaymentMethodStatusCompatibility('cod', 'cod_pending', 'not_applicable')
  );
});

test('8. Razorpay Route defaults to disabled and gates linked-account transfers strictly', () => {
  assert.equal(DEFAULT_PAYMENT_GATEWAY_CONFIG.onlinePaymentsEnabled, false);
  assert.equal(DEFAULT_PAYMENT_GATEWAY_CONFIG.razorpayRouteEnabled, false);
  assert.equal(DEFAULT_PAYMENT_GATEWAY_CONFIG.routeApprovalStatus, 'not_approved');

  const activeAccount = {
    route_onboarding_status: 'active' as const,
    payouts_enabled: true,
    razorpay_linked_account_id: 'acc_test123456',
  };

  assert.equal(isRouteTransferEligible(DEFAULT_PAYMENT_GATEWAY_CONFIG, activeAccount), false);
  assert.equal(
    isRouteTransferEligible({ razorpayRouteEnabled: true, routeApprovalStatus: 'pending_review' }, activeAccount),
    false
  );
  assert.equal(
    isRouteTransferEligible({ razorpayRouteEnabled: true, routeApprovalStatus: 'approved' }, activeAccount),
    true
  );
});

test('9. Stage 7.8.1 Razorpay client adapter stays disabled and frontend never contains secrets', async () => {
  const provider = getPaymentProvider('razorpay');
  const availability = provider.getAvailability();
  assert.equal(availability.provider, 'razorpay');
  assert.equal(availability.onlineCheckoutReady, false);

  await assert.rejects(
    () =>
      provider.createPaymentOrder({
        shippingAddress: { fullName: 'Test Buyer' },
        items: [{ product_id: 'p1', quantity: 1 }],
        idempotencyKey: 'idem-1',
      }),
    OnlinePaymentsNotEnabledError
  );

  await assert.rejects(
    () =>
      provider.verifyPayment({
        orderId: 'o1',
        providerOrderId: 'order_1',
        providerPaymentId: 'pay_1',
        providerSignature: 'sig_1',
      }),
    OnlinePaymentsNotEnabledError
  );

  // Verify zero server-side secret names appear inside src/ runtime code (excluding test files)
  const srcFiles = walkFiles(path.join(repoRoot, 'src')).filter(
    (file) => !file.includes('__tests__')
  );
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      content,
      /RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY/,
      `Frontend source file must never reference server secrets: ${file}`
    );
  }
});
