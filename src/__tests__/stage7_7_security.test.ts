/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_ROLE_PERMISSIONS,
  canAccessAdminTab,
  canAdminCancelOrder,
  canCustomerCancelOrder,
  canSellerCancelOrderStatus,
  prepareCheckoutItems,
} from '../utils/commerceRules.ts';

const repoRoot = process.cwd();
const migration007 = fs.readFileSync(
  path.join(repoRoot, 'supabase/migrations/007_final_security_and_commerce_fixes.sql'),
  'utf8'
);
const adminServiceSource = fs.readFileSync(
  path.join(repoRoot, 'src/services/adminService.ts'),
  'utf8'
);
const databaseServiceSource = fs.readFileSync(
  path.join(repoRoot, 'src/services/database.ts'),
  'utf8'
);

function extractSqlBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing SQL marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing SQL end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('1. Content Admin cannot access operational tabs or operational tables', () => {
  assert.deepEqual(ADMIN_ROLE_PERMISSIONS.content_admin, [
    'overview',
    'moderation',
    'communities',
    'content',
  ]);
  for (const restrictedTab of ['sellers', 'orders', 'customers', 'returns', 'settings', 'audit'] as const) {
    assert.equal(
      canAccessAdminTab('content_admin', restrictedTab),
      false,
      `content_admin must not access ${restrictedTab}`
    );
  }
  assert.equal(canAccessAdminTab('operations_admin', 'sellers'), true);
  assert.equal(canAccessAdminTab('operations_admin', 'orders'), true);
  assert.equal(canAccessAdminTab('operations_admin', 'audit'), false);
  assert.equal(canAccessAdminTab('super_admin', 'audit'), true);

  // adminService content_admin path must only query products & get_moderation_seller_summary
  const contentBranch = extractSqlBlock(
    adminServiceSource,
    "if (adminRole === 'content_admin')",
    "const canViewAuditLogs = adminRole === 'super_admin';"
  );
  assert.match(contentBranch, /\.from\('products'\)/);
  assert.match(contentBranch, /\.rpc\('get_moderation_seller_summary'\)/);
  assert.doesNotMatch(
    contentBranch,
    /\.from\(['"](seller_profiles|orders|seller_orders|profiles|audit_logs|payments|seller_applications)['"]\)/
  );
  assert.doesNotMatch(contentBranch, /seller_profiles\s*\(/);

  const opsBranch = extractSqlBlock(
    adminServiceSource,
    "const canViewAuditLogs = adminRole === 'super_admin';",
    'if (sellerErr || orderErr)'
  );
  assert.match(opsBranch, /canViewAuditLogs[\s\S]*\.from\('audit_logs'\)/);

  // 007 must remove is_admin() from sensitive RLS policies while preserving owner access
  const rbacSection = extractSqlBlock(
    migration007,
    '-- 2. STRICT ROLE SEPARATION FOR CONTENT ADMIN vs OPERATIONS ADMIN',
    '-- 3. SAFE PUBLIC SELLER DIRECTORY'
  );
  assert.match(rbacSection, /on public\.profiles for select[\s\S]*auth\.uid\(\) = id[\s\S]*is_operations_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.user_roles for select[\s\S]*auth\.uid\(\) = user_id[\s\S]*is_super_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.seller_profiles for select[\s\S]*user_id = auth\.uid\(\)[\s\S]*is_operations_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.orders for select[\s\S]*auth\.uid\(\) = customer_id[\s\S]*is_operations_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.seller_orders for select[\s\S]*is_operations_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.payments for select[\s\S]*is_operations_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.seller_applications for select[\s\S]*is_operations_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.audit_logs for select[\s\S]*is_super_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /on public\.audit_logs for insert[\s\S]*actor_id = auth\.uid\(\)[\s\S]*is_content_admin\(auth\.uid\(\)\)/);
  assert.match(rbacSection, /create or replace function public\.get_moderation_seller_summary\(\)/);
});

test('2. Seller cannot feature own products on INSERT or UPDATE', () => {
  const fn = extractSqlBlock(
    migration007,
    'create or replace function public.guard_product_moderation_columns()',
    'create or replace function public.handle_seller_status_product_visibility()'
  );
  assert.match(fn, /or new\.is_featured = true[\s\S]*if tg_op = 'INSERT'/);
  assert.match(fn, /if new\.is_featured is distinct from old\.is_featured then/);
});

test('3. Trusted SQL maintenance removes current_user illusion and avoids broad bypasses', () => {
  const maintenanceHelper = extractSqlBlock(
    migration007,
    'create or replace function public.is_trusted_sql_maintenance()',
    '-- 2. STRICT ROLE SEPARATION'
  );
  assert.doesNotMatch(maintenanceHelper, /security definer/i);
  assert.match(maintenanceHelper, /session_user in \('postgres', 'supabase_admin'\)/);
  assert.match(maintenanceHelper, /auth\.uid\(\) is null/);
  assert.match(maintenanceHelper, /request\.jwt\.claim\.role/);

  const sellerGuard = extractSqlBlock(
    migration007,
    'create or replace function public.guard_seller_profile_status()',
    'create or replace function public.guard_seller_order_financials()'
  );
  assert.doesNotMatch(sellerGuard, /\bcurrent_user\b/);
  assert.match(sellerGuard, /session_user in \('supabase_auth_admin', 'postgres', 'supabase_admin'\)/);
  assert.match(sellerGuard, /public\.is_trusted_sql_maintenance\(\)/);
  assert.doesNotMatch(migration007, /pg_trigger_depth/i);
});

test('4. Suspended and rejected seller products are hidden and require re-moderation', () => {
  const visibilitySection = extractSqlBlock(
    migration007,
    '-- Public users see ONLY approved + published products belonging to ACTIVE sellers',
    '-- Guard product moderation & is_featured columns'
  );
  assert.match(visibilitySection, /on public\.products for select[\s\S]*sp\.account_status = 'active'/);
  assert.match(visibilitySection, /on public\.product_images for select[\s\S]*sp\.account_status = 'active'/);
  assert.match(visibilitySection, /on public\.product_variants for select[\s\S]*sp\.account_status = 'active'/);

  const sellerStatusTrigger = extractSqlBlock(
    migration007,
    'create or replace function public.handle_seller_status_product_visibility()',
    'drop trigger if exists on_seller_status_hide_products'
  );
  assert.match(sellerStatusTrigger, /old\.account_status = 'active' and new\.account_status <> 'active'/);
  assert.match(sellerStatusTrigger, /when approval_status = 'approved' then 'pending_review'/);
  assert.match(sellerStatusTrigger, /is_published = false/);
});

test('5. Direct online payment RPC and client calls are rejected until gateway exists', () => {
  const checkoutRpc = extractSqlBlock(
    migration007,
    'create or replace function public.create_multi_vendor_order(',
    '-- 6. CANCELLATION, COD PROTECTION'
  );
  assert.match(checkoutRpc, /if p_payment_method = 'online' then[\s\S]*raise exception/);
  assert.match(checkoutRpc, /if p_payment_method <> 'cod' then[\s\S]*raise exception/);
  assert.match(databaseServiceSource, /if \(params\.paymentMethod === 'online'\)/);
});

test('6 & 7. Multi-item checkout deduplicates lines and locks deterministically by (product_id, variant_id)', () => {
  const basketA = prepareCheckoutItems([
    { product_id: 'prod-b', variant_id: 'var-2', quantity: 1 },
    { product_id: 'prod-a', variant_id: null, quantity: 2 },
    { product_id: 'prod-b', variant_id: 'var-2', quantity: 3 },
    { product_id: 'prod-b', variant_id: 'var-1', quantity: 1 },
    { product_id: 'prod-c', variant_id: null, quantity: 0 },
  ]);
  const basketB = prepareCheckoutItems([
    { product_id: 'prod-b', variant_id: 'var-1', quantity: 1 },
    { product_id: 'prod-b', variant_id: 'var-2', quantity: 4 },
    { product_id: 'prod-a', variant_id: null, quantity: 2 },
  ]);
  assert.deepEqual(basketA, [
    { product_id: 'prod-a', variant_id: null, quantity: 2 },
    { product_id: 'prod-b', variant_id: 'var-1', quantity: 1 },
    { product_id: 'prod-b', variant_id: 'var-2', quantity: 4 },
  ]);
  assert.deepEqual(basketA, basketB);

  const checkoutRpc = extractSqlBlock(
    migration007,
    'create or replace function public.create_multi_vendor_order(',
    '-- 6. CANCELLATION, COD PROTECTION'
  );
  assert.match(checkoutRpc, /sum\(\(elem->>'quantity'\)::integer\)/);
  assert.match(checkoutRpc, /group by[\s\S]*\(elem->>'product_id'\)::uuid/);
  assert.match(checkoutRpc, /order by 1 asc, 2 asc nulls first/);
});

test('8. Partial cancellation allows customer cancellation of remaining eligible splits', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'partially_cancelled',
      payment_status: 'cod_pending',
      seller_orders: [
        { id: 'so-1', seller_id: 's1', subtotal: 1000, fulfilment_status: 'cancelled' },
        { id: 'so-2', seller_id: 's2', subtotal: 2000, fulfilment_status: 'pending' },
      ],
    }),
    true
  );

  assert.equal(
    canCustomerCancelOrder({
      status: 'partially_cancelled',
      payment_status: 'cod_pending',
      seller_orders: [
        { id: 'so-1', seller_id: 's1', subtotal: 1000, fulfilment_status: 'cancelled' },
        { id: 'so-2', seller_id: 's2', subtotal: 2000, fulfilment_status: 'packed' },
      ],
    }),
    false
  );

  const customerCancelFn = extractSqlBlock(
    migration007,
    'create or replace function public.cancel_customer_order(',
    'revoke all on function public.cancel_customer_order'
  );
  assert.match(customerCancelFn, /'partially_cancelled'/);
  assert.match(customerCancelFn, /where order_id = v_order\.id and fulfilment_status <> 'cancelled'/);
});

test('9. Seller cancellation after packing is blocked in UI and SQL, with consistent lock order', () => {
  assert.equal(canSellerCancelOrderStatus('new'), true);
  assert.equal(canSellerCancelOrderStatus('confirmed'), true);
  assert.equal(canSellerCancelOrderStatus('processing'), true);
  assert.equal(canSellerCancelOrderStatus('ready_for_dispatch'), false);
  assert.equal(canSellerCancelOrderStatus('dispatched'), false);
  assert.equal(canSellerCancelOrderStatus('delivered'), false);

  const sellerCancelFn = extractSqlBlock(
    migration007,
    'create or replace function public.cancel_seller_order(',
    'revoke all on function public.cancel_seller_order'
  );
  // Consistent AB order: lock orders before seller_orders
  const lockOrdersIdx = sellerCancelFn.indexOf('from public.orders where id = v_order_id for update');
  const lockSoIdx = sellerCancelFn.indexOf('from public.seller_orders where id = p_seller_order_id for update');
  assert.ok(lockOrdersIdx !== -1 && lockSoIdx !== -1 && lockOrdersIdx < lockSoIdx);

  assert.match(sellerCancelFn, /'packed', 'ready_to_dispatch', 'shipped', 'dispatched', 'delivered'/);
  assert.match(sellerCancelFn, /if v_so\.fulfilment_status not in \('shipped', 'dispatched', 'delivered'\) then[\s\S]*internal_restore_seller_order_inventory/);
});

test('10. COD collected or settled orders cannot be bypassed by cancellation', () => {
  assert.equal(
    canCustomerCancelOrder({
      status: 'confirmed',
      payment_status: 'cod_collected',
      seller_orders: [
        { id: 'so-1', seller_id: 's1', subtotal: 1000, fulfilment_status: 'pending', cod_reconciliation_status: 'collected' },
      ],
    }),
    false
  );
  assert.equal(
    canAdminCancelOrder({
      orderStatus: 'confirmed',
      paymentStatus: 'cod_pending',
      sellerOrders: [{ fulfilmentStatus: 'pending', codReconciliationStatus: 'settled' }],
    }),
    false
  );
  assert.equal(
    canAdminCancelOrder({
      orderStatus: 'confirmed',
      paymentStatus: 'cod_pending',
      sellerOrders: [{ fulfilmentStatus: 'dispatched', codReconciliationStatus: 'awaiting_collection' }],
    }),
    true
  );

  assert.match(migration007, /payment_status = 'cod_collected'[\s\S]*cod_reconciliation_status in \('collected', 'settled'\)/);
});

test('11. Parent order status syncs automatically and never fabricates refunds', () => {
  assert.match(migration007, /create trigger on_sync_parent_order_status[\s\S]*after update of fulfilment_status on public\.seller_orders/);
  const recomputeFn = extractSqlBlock(
    migration007,
    'create or replace function public.recompute_parent_order_status(',
    'revoke all on function public.recompute_parent_order_status'
  );
  assert.match(recomputeFn, /from public\.payments[\s\S]*status = 'refunded'/);
  assert.match(recomputeFn, /when v_order\.payment_status = 'paid' then 'refund_pending'/);
  assert.match(recomputeFn, /v_next_status := 'partially_fulfilled'/);
  assert.match(recomputeFn, /v_next_status := 'partially_dispatched'/);
  assert.match(recomputeFn, /v_next_status := 'dispatched'/);
  assert.match(recomputeFn, /v_next_status := 'delivered'/);
});

test('12. Public seller directory uses security_invoker view over scoped active-only function', () => {
  const dirSection = extractSqlBlock(
    migration007,
    '-- 3. SAFE PUBLIC SELLER DIRECTORY',
    '-- 4. PROTECT products.is_featured'
  );
  assert.match(dirSection, /create or replace function public\.get_public_seller_directory\(\)/);
  assert.match(dirSection, /where sp\.account_status = 'active'/);
  assert.doesNotMatch(dirSection, /contact_email|contact_phone/);
  assert.match(dirSection, /create view public\.public_seller_directory[\s\S]*with \(security_invoker = true\)/);
  assert.match(dirSection, /grant select on public\.public_seller_directory to anon, authenticated/);
});
