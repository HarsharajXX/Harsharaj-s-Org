-- NOHAJ Marketplace — Stage 7.8.1: Database and Payment Foundation
-- Migration: 008_payment_and_settlement_foundation.sql
-- Depends on: 001_initial_schema.sql through 007_final_security_and_commerce_fixes.sql.
-- Safe to rerun: Yes (forward-only, transaction-wrapped, precondition-checked, idempotent).
--
-- Scope:
--   - Integer-paise monetary columns & safe backfill for orders, seller_orders, order_items, payments.
--   - Separation of online payment statuses vs COD collection/remittance lifecycle.
--   - Payment gateway config (Razorpay Route disabled by default: razorpay_route_enabled = false).
--   - Payment attempts, webhook event idempotency, seller settlement accounts, transfers,
--     bank settlements, refund records, COD collection/remittance ledger, reconciliation runs,
--     and immutable append-only financial_ledger_entries.
--   - Exact-once inventory reservation & expiry helpers for upcoming Stage 7.8.2 online checkout.
--   - Strict RLS isolation excluding content_admin from all financial and settlement data.

begin;

-- ============================================================================
-- 0. PRECONDITION CHECKS (VERIFY 001–007 EXIST BEFORE APPLYING 008)
-- ============================================================================

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.seller_profiles') is null
     or to_regclass('public.products') is null
     or to_regclass('public.product_variants') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.seller_orders') is null
     or to_regclass('public.order_items') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.returns') is null
     or to_regclass('public.marketplace_settings') is null
     or to_regprocedure('public.is_operations_admin(uuid)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null
     or to_regprocedure('public.is_trusted_sql_maintenance()') is null
     or to_regprocedure('public.internal_restore_seller_order_inventory(uuid)') is null then
    raise exception 'Precondition failed: migrations 001 through 007 must be applied before 008_payment_and_settlement_foundation.sql.';
  end if;
end $$;

-- ============================================================================
-- 1. MARKETPLACE & GATEWAY CONFIGURATION (ROUTE DISABLED BY DEFAULT)
-- ============================================================================

alter table public.marketplace_settings
  add column if not exists commission_basis_points integer not null default 1200
    check (commission_basis_points >= 0 and commission_basis_points <= 5000),
  add column if not exists commission_applies_to_shipping boolean not null default false,
  add column if not exists commission_applies_to_tax boolean not null default false,
  add column if not exists payment_reservation_ttl_minutes integer not null default 20
    check (payment_reservation_ttl_minutes between 5 and 120);

update public.marketplace_settings
set commission_basis_points = round(commission_rate * 10000)::integer
where commission_basis_points <> round(commission_rate * 10000)::integer;

-- Keep gateway/Route configuration out of public marketplace_settings RLS
create table if not exists public.payment_gateway_config (
  id integer primary key default 1 check (id = 1),
  active_provider text not null default 'razorpay' check (active_provider in ('razorpay')),
  online_payments_enabled boolean not null default false,
  razorpay_mode text not null default 'test' check (razorpay_mode in ('test', 'live')),
  razorpay_route_enabled boolean not null default false,
  route_approval_status text not null default 'not_approved'
    check (route_approval_status in ('not_approved', 'pending_review', 'approved', 'suspended')),
  route_approval_notes text default 'Requires Razorpay Route marketplace eligibility and account approval before enabling.',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.payment_gateway_config (
  id, active_provider, online_payments_enabled, razorpay_mode,
  razorpay_route_enabled, route_approval_status
) values (
  1, 'razorpay', false, 'test', false, 'not_approved'
)
on conflict (id) do nothing;

alter table public.payment_gateway_config enable row level security;

drop policy if exists "Operations and super admins read payment gateway config" on public.payment_gateway_config;
create policy "Operations and super admins read payment gateway config"
  on public.payment_gateway_config for select
  using (public.is_operations_admin(auth.uid()));

drop policy if exists "Super admin updates payment gateway config" on public.payment_gateway_config;
create policy "Super admin updates payment gateway config"
  on public.payment_gateway_config for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

-- ============================================================================
-- 2. EXTEND ORDERS, SELLER_ORDERS & ORDER_ITEMS WITH INTEGER PAISE ACCOUNTING
-- ============================================================================

alter table public.orders
  add column if not exists currency text not null default 'INR' check (currency = 'INR'),
  add column if not exists checkout_idempotency_key text,
  add column if not exists subtotal_paise bigint not null default 0 check (subtotal_paise >= 0),
  add column if not exists discount_paise bigint not null default 0 check (discount_paise >= 0),
  add column if not exists shipping_paise bigint not null default 0 check (shipping_paise >= 0),
  add column if not exists tax_paise bigint not null default 0 check (tax_paise >= 0),
  add column if not exists total_paise bigint not null default 0 check (total_paise >= 0),
  add column if not exists reservation_expires_at timestamptz,
  add column if not exists reservation_released_at timestamptz,
  add column if not exists cod_lifecycle_status text not null default 'not_applicable';

alter table public.orders drop constraint if exists orders_cod_lifecycle_status_check;
alter table public.orders
  add constraint orders_cod_lifecycle_status_check
  check (cod_lifecycle_status in (
    'not_applicable',
    'pending_confirmation',
    'confirmed',
    'dispatched',
    'out_for_delivery',
    'delivered',
    'collected',
    'remitted',
    'cancelled',
    'failed_delivery'
  ));

alter table public.orders drop constraint if exists orders_order_status_check;
alter table public.orders
  add constraint orders_order_status_check
  check (order_status in (
    'pending', 'pending_payment', 'confirmed', 'processing',
    'partially_dispatched', 'dispatched', 'partially_fulfilled',
    'fulfilled', 'delivered', 'cancelled', 'partially_cancelled', 'expired'
  ));

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in (
    'created', 'pending', 'authorized', 'captured', 'paid',
    'failed', 'expired', 'refund_pending', 'refunded', 'partially_refunded',
    'cod_pending', 'cod_collected', 'cancelled'
  ));

create unique index if not exists idx_orders_customer_idempotency
  on public.orders(customer_id, checkout_idempotency_key)
  where checkout_idempotency_key is not null;

create index if not exists idx_orders_pending_reservation_expiry
  on public.orders(reservation_expires_at)
  where payment_method = 'online'
    and order_status = 'pending_payment'
    and reservation_released_at is null;

-- Safe non-destructive backfill of existing numeric INR columns -> integer paise
update public.orders
set
  subtotal_paise = round(subtotal * 100)::bigint,
  shipping_paise = round(shipping_amount * 100)::bigint,
  total_paise = round(total_amount * 100)::bigint,
  cod_lifecycle_status = case
    when payment_method = 'cod' and order_status = 'cancelled' then 'cancelled'
    when payment_method = 'cod' and payment_status = 'cod_collected' then 'collected'
    when payment_method = 'cod' and order_status = 'delivered' then 'delivered'
    when payment_method = 'cod' and order_status in ('dispatched', 'partially_dispatched') then 'dispatched'
    when payment_method = 'cod' then 'confirmed'
    else 'not_applicable'
  end
where subtotal_paise = 0
  and total_paise = 0
  and total_amount > 0;

alter table public.seller_orders
  add column if not exists currency text not null default 'INR' check (currency = 'INR'),
  add column if not exists subtotal_paise bigint not null default 0 check (subtotal_paise >= 0),
  add column if not exists discount_paise bigint not null default 0 check (discount_paise >= 0),
  add column if not exists shipping_paise bigint not null default 0 check (shipping_paise >= 0),
  add column if not exists tax_paise bigint not null default 0 check (tax_paise >= 0),
  add column if not exists commission_amount_paise bigint not null default 0 check (commission_amount_paise >= 0),
  add column if not exists seller_gross_paise bigint not null default 0 check (seller_gross_paise >= 0),
  add column if not exists seller_payable_paise bigint not null default 0 check (seller_payable_paise >= 0),
  add column if not exists gateway_fee_paise bigint not null default 0 check (gateway_fee_paise >= 0),
  add column if not exists adjustment_paise bigint not null default 0,
  add column if not exists refund_paise bigint not null default 0 check (refund_paise >= 0),
  add column if not exists reversal_paise bigint not null default 0 check (reversal_paise >= 0),
  add column if not exists settled_paise bigint not null default 0 check (settled_paise >= 0),
  add column if not exists outstanding_balance_paise bigint not null default 0;

alter table public.seller_orders drop constraint if exists seller_orders_cod_reconciliation_status_check;
alter table public.seller_orders
  add constraint seller_orders_cod_reconciliation_status_check
  check (cod_reconciliation_status in (
    'not_applicable', 'awaiting_collection', 'collected', 'remitted', 'settled'
  ));

update public.seller_orders
set
  subtotal_paise = round(subtotal * 100)::bigint,
  commission_amount_paise = round(commission_amount * 100)::bigint,
  seller_gross_paise = round(subtotal * 100)::bigint,
  seller_payable_paise = round(seller_payout_amount * 100)::bigint,
  outstanding_balance_paise = case
    when fulfilment_status = 'cancelled' then 0
    else round(seller_payout_amount * 100)::bigint
  end
where subtotal_paise = 0
  and subtotal > 0;

alter table public.order_items
  add column if not exists unit_price_paise bigint not null default 0 check (unit_price_paise >= 0),
  add column if not exists line_total_paise bigint not null default 0 check (line_total_paise >= 0);

update public.order_items
set
  unit_price_paise = round(unit_price * 100)::bigint,
  line_total_paise = round(unit_price * 100)::bigint * quantity
where unit_price_paise = 0
  and unit_price > 0;

-- ============================================================================
-- 3. EXTEND PAYMENTS + ADD PAYMENT ATTEMPTS & WEBHOOK EVENT IDEMPOTENCY
-- ============================================================================

alter table public.payments
  add column if not exists customer_id uuid references public.profiles(id),
  add column if not exists provider_order_id text,
  add column if not exists amount_paise bigint not null default 0 check (amount_paise >= 0),
  add column if not exists captured_paise bigint not null default 0 check (captured_paise >= 0),
  add column if not exists refunded_paise bigint not null default 0 check (refunded_paise >= 0),
  add column if not exists idempotency_key text,
  add column if not exists signature_verified boolean not null default false,
  add column if not exists api_verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in (
    'created', 'pending', 'authorized', 'captured',
    'failed', 'expired', 'refund_pending', 'partially_refunded', 'refunded'
  ));

update public.payments
set amount_paise = round(amount * 100)::bigint
where amount_paise = 0 and amount > 0;

create unique index if not exists idx_payments_provider_order_id
  on public.payments(provider_order_id)
  where provider_order_id is not null;

create unique index if not exists idx_payments_provider_payment_id
  on public.payments(provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists idx_payments_idempotency_key
  on public.payments(idempotency_key)
  where idempotency_key is not null;

create table if not exists public.payment_attempts (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  provider text not null default 'razorpay' check (provider in ('razorpay')),
  provider_order_id text unique,
  provider_payment_id text unique,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created'
    check (status in ('created', 'pending', 'authorized', 'captured', 'failed', 'expired')),
  failure_code text,
  failure_reason text,
  signature_verified boolean not null default false,
  api_verified boolean not null default false,
  idempotency_key text unique,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt_number)
);
create index if not exists idx_payment_attempts_payment_id on public.payment_attempts(payment_id);
create index if not exists idx_payment_attempts_order_id on public.payment_attempts(order_id);

create table if not exists public.payment_webhook_events (
  id uuid primary key default uuid_generate_v4(),
  provider text not null default 'razorpay' check (provider in ('razorpay')),
  event_id text not null unique,
  event_type text not null,
  provider_order_id text,
  provider_payment_id text,
  provider_refund_id text,
  provider_transfer_id text,
  signature_valid boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  safe_payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_webhook_events_type_status
  on public.payment_webhook_events(event_type, processing_status);
create index if not exists idx_webhook_events_provider_payment_id
  on public.payment_webhook_events(provider_payment_id)
  where provider_payment_id is not null;

-- ============================================================================
-- 4. SELLER SETTLEMENT ACCOUNTS (RAZORPAY ROUTE ONBOARDING — GATED)
-- ============================================================================

create table if not exists public.seller_settlement_accounts (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid unique not null references public.seller_profiles(id) on delete cascade,
  legal_business_name text not null,
  business_type text,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  pan_last4 text,
  gstin text,
  beneficiary_name text,
  bank_account_last4 text,
  bank_ifsc text,
  settlement_destination_type text not null default 'bank_account'
    check (settlement_destination_type in ('bank_account', 'upi_vpa')),
  kyc_storage_paths text[] not null default '{}',
  seller_consent_accepted boolean not null default false,
  seller_consent_accepted_at timestamptz,
  kyc_status text not null default 'not_started'
    check (kyc_status in (
      'not_started', 'submitted', 'verification_pending',
      'action_required', 'active', 'rejected', 'suspended'
    )),
  razorpay_linked_account_id text unique,
  razorpay_product_id text,
  route_onboarding_status text not null default 'not_started'
    check (route_onboarding_status in (
      'not_started', 'submitted', 'verification_pending',
      'action_required', 'active', 'rejected', 'suspended'
    )),
  payouts_enabled boolean not null default false,
  notes text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seller_settlement_accounts_status
  on public.seller_settlement_accounts(route_onboarding_status, kyc_status);

-- Prevent sellers from self-activating KYC, Linked Account IDs, or Route payouts
create or replace function public.guard_seller_settlement_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_can_administer boolean := (
    public.is_operations_admin(auth.uid())
    or public.is_trusted_sql_maintenance()
    or (
      auth.uid() is null
      and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    )
  );
begin
  if not v_can_administer then
    if tg_op = 'INSERT' then
      if new.kyc_status not in ('not_started', 'submitted')
         or new.route_onboarding_status not in ('not_started', 'submitted')
         or new.payouts_enabled = true
         or new.razorpay_linked_account_id is not null
         or new.razorpay_product_id is not null
         or new.reviewed_by is not null
         or new.reviewed_at is not null then
        raise exception 'Only authorized operations administrators or server settlement functions can activate KYC or Razorpay Route linked accounts.';
      end if;
    else
      if new.kyc_status is distinct from old.kyc_status and new.kyc_status not in ('submitted') then
        raise exception 'Only authorized operations administrators can approve, reject, or suspend seller KYC status.';
      end if;
      if new.route_onboarding_status is distinct from old.route_onboarding_status
         and new.route_onboarding_status not in ('submitted') then
        raise exception 'Only authorized operations administrators or server settlement functions can update Route onboarding status.';
      end if;
      if new.payouts_enabled is distinct from old.payouts_enabled
         or new.razorpay_linked_account_id is distinct from old.razorpay_linked_account_id
         or new.razorpay_product_id is distinct from old.razorpay_product_id
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at then
        raise exception 'Only authorized operations administrators or server settlement functions can modify Route account identifiers or payout eligibility.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_guard_seller_settlement_account on public.seller_settlement_accounts;
create trigger on_guard_seller_settlement_account
  before insert or update on public.seller_settlement_accounts
  for each row execute procedure public.guard_seller_settlement_account();

-- ============================================================================
-- 5. ROUTE TRANSFERS, SETTLEMENTS, REFUNDS, COD LEDGER, LEDGER & RECONCILIATION
-- ============================================================================

create table if not exists public.seller_transfers (
  id uuid primary key default uuid_generate_v4(),
  seller_order_id uuid not null references public.seller_orders(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  seller_id uuid not null references public.seller_profiles(id),
  settlement_account_id uuid not null references public.seller_settlement_accounts(id),
  provider_transfer_id text unique,
  idempotency_key text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  reversed_paise bigint not null default 0 check (reversed_paise >= 0 and reversed_paise <= amount_paise),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'pending'
    check (status in ('pending', 'created', 'processed', 'on_hold', 'failed', 'partially_reversed', 'reversed')),
  on_hold boolean not null default false,
  hold_until timestamptz,
  failure_reason text,
  settlement_status text not null default 'pending'
    check (settlement_status in ('pending', 'scheduled', 'settled', 'failed', 'reversed')),
  settled_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seller_transfers_seller_id on public.seller_transfers(seller_id);
create index if not exists idx_seller_transfers_order_id on public.seller_transfers(order_id);

create table if not exists public.settlement_records (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.seller_profiles(id),
  seller_transfer_id uuid references public.seller_transfers(id) on delete set null,
  provider_settlement_id text unique,
  utr text,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created'
    check (status in ('created', 'processed', 'settled', 'failed')),
  settled_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_settlement_records_seller_id on public.settlement_records(seller_id);

create table if not exists public.refund_records (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_order_id uuid references public.seller_orders(id) on delete set null,
  payment_id uuid references public.payments(id),
  return_id uuid references public.returns(id),
  refund_channel text not null check (refund_channel in ('razorpay', 'cod_manual')),
  provider_refund_id text unique,
  idempotency_key text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  shipping_refund_paise bigint not null default 0 check (shipping_refund_paise >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'failed')),
  reversal_status text not null default 'not_applicable'
    check (reversal_status in ('not_applicable', 'pending', 'reversed', 'failed')),
  reason text not null,
  initiated_by uuid references public.profiles(id),
  processed_at timestamptz,
  failure_reason text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_refund_records_order_id on public.refund_records(order_id);
create index if not exists idx_refund_records_seller_order_id on public.refund_records(seller_order_id);

create table if not exists public.cod_collection_records (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_order_id uuid unique not null references public.seller_orders(id) on delete cascade,
  seller_id uuid not null references public.seller_profiles(id),
  cod_order_value_paise bigint not null check (cod_order_value_paise >= 0),
  collected_amount_paise bigint not null default 0 check (collected_amount_paise >= 0),
  courier_name text,
  courier_charges_paise bigint not null default 0 check (courier_charges_paise >= 0),
  commission_paise bigint not null default 0 check (commission_paise >= 0),
  seller_payable_paise bigint not null default 0 check (seller_payable_paise >= 0),
  outstanding_amount_paise bigint not null default 0,
  collection_status text not null default 'pending_confirmation'
    check (collection_status in (
      'pending_confirmation', 'confirmed', 'dispatched', 'out_for_delivery',
      'delivered', 'collected', 'remitted', 'cancelled', 'failed_delivery'
    )),
  collected_at timestamptz,
  remittance_reference text,
  remittance_date timestamptz,
  reconciliation_status text not null default 'awaiting_collection'
    check (reconciliation_status in (
      'awaiting_collection', 'collected', 'remitted', 'disputed', 'cancelled'
    )),
  updated_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cod_collection_seller_id on public.cod_collection_records(seller_id);
create index if not exists idx_cod_collection_status on public.cod_collection_records(reconciliation_status, collection_status);

-- Enforce strict COD reconciliation integrity:
--   - Delivering a COD parcel does NOT mark it collected or remitted.
--   - Marking collected requires collected_amount_paise > 0.
--   - Marking remitted requires non-empty remittance_reference and remittance_date.
create or replace function public.guard_cod_collection_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.collection_status = 'collected' or new.reconciliation_status = 'collected' then
    if coalesce(new.collected_amount_paise, 0) <= 0 then
      raise exception 'COD cannot be marked collected without a positive collected_amount_paise.';
    end if;
    if new.collected_at is null then
      new.collected_at := now();
    end if;
  end if;

  if new.collection_status = 'remitted' or new.reconciliation_status = 'remitted' then
    if coalesce(new.collected_amount_paise, 0) <= 0 then
      raise exception 'COD cannot be marked remitted before cash collection is recorded.';
    end if;
    if nullif(trim(coalesce(new.remittance_reference, '')), '') is null
       or new.remittance_date is null then
      raise exception 'COD cannot be marked remitted without remittance_reference and remittance_date.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_guard_cod_collection_record on public.cod_collection_records;
create trigger on_guard_cod_collection_record
  before insert or update on public.cod_collection_records
  for each row execute procedure public.guard_cod_collection_record();

-- Backfill cod_collection_records for any existing COD seller_orders
insert into public.cod_collection_records (
  order_id, seller_order_id, seller_id,
  cod_order_value_paise, collected_amount_paise,
  commission_paise, seller_payable_paise, outstanding_amount_paise,
  collection_status,
  reconciliation_status
)
select
  so.order_id,
  so.id,
  so.seller_id,
  so.subtotal_paise,
  case when so.cod_reconciliation_status in ('collected', 'remitted', 'settled') then so.subtotal_paise else 0 end,
  so.commission_amount_paise,
  so.seller_payable_paise,
  case when so.fulfilment_status = 'cancelled' or so.cod_reconciliation_status in ('remitted', 'settled') then 0 else so.seller_payable_paise end,
  case
    when so.fulfilment_status = 'cancelled' then 'cancelled'
    when so.cod_reconciliation_status in ('remitted', 'settled') then 'remitted'
    when so.cod_reconciliation_status = 'collected' then 'collected'
    when so.fulfilment_status = 'delivered' then 'delivered'
    when so.fulfilment_status in ('shipped', 'dispatched') then 'dispatched'
    else 'confirmed'
  end,
  case
    when so.fulfilment_status = 'cancelled' then 'cancelled'
    when so.cod_reconciliation_status in ('remitted', 'settled') then 'remitted'
    when so.cod_reconciliation_status = 'collected' then 'collected'
    else 'awaiting_collection'
  end
from public.seller_orders so
join public.orders o on o.id = so.order_id
where o.payment_method = 'cod'
on conflict (seller_order_id) do nothing;

-- Append-only immutable financial transaction ledger
create table if not exists public.financial_ledger_entries (
  id uuid primary key default uuid_generate_v4(),
  entry_group_id uuid not null default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete restrict,
  seller_order_id uuid references public.seller_orders(id) on delete restrict,
  seller_id uuid references public.seller_profiles(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  refund_id uuid references public.refund_records(id) on delete restrict,
  transfer_id uuid references public.seller_transfers(id) on delete restrict,
  cod_record_id uuid references public.cod_collection_records(id) on delete restrict,
  entry_type text not null check (entry_type in (
    'order_charge',
    'payment_captured',
    'commission_accrual',
    'seller_payable_credit',
    'shipping_allocation',
    'tax_allocation',
    'discount_allocation',
    'gateway_fee',
    'courier_fee',
    'cod_collected',
    'cod_remitted',
    'transfer_initiated',
    'transfer_settled',
    'refund_debit',
    'transfer_reversal',
    'manual_adjustment'
  )),
  direction text not null check (direction in ('debit', 'credit')),
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  commission_rate_bps integer,
  description text not null,
  reference_id text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_ledger_order_id on public.financial_ledger_entries(order_id);
create index if not exists idx_ledger_seller_id on public.financial_ledger_entries(seller_id);
create index if not exists idx_ledger_entry_type on public.financial_ledger_entries(entry_type, created_at desc);

-- Strictly prevent UPDATE or DELETE on financial_ledger_entries (use compensating entries only)
create or replace function public.guard_financial_ledger_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'financial_ledger_entries is append-only; insert compensating entries instead of updating or deleting historical rows.';
end;
$$;

drop trigger if exists on_guard_financial_ledger_immutable on public.financial_ledger_entries;
create trigger on_guard_financial_ledger_immutable
  before update or delete on public.financial_ledger_entries
  for each row execute procedure public.guard_financial_ledger_immutable();

create table if not exists public.reconciliation_runs (
  id uuid primary key default uuid_generate_v4(),
  run_type text not null check (run_type in ('razorpay_payments', 'razorpay_transfers', 'cod_remittance', 'full')),
  status text not null default 'started'
    check (status in ('started', 'completed', 'completed_with_discrepancies', 'failed')),
  checked_count integer not null default 0,
  discrepancy_count integer not null default 0,
  summary jsonb,
  started_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================================
-- 6. RLS & PERMISSIONS (CONTENT ADMIN STRICTLY EXCLUDED FROM ALL FINANCIAL DATA)
-- ============================================================================

alter table public.payment_attempts enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.seller_settlement_accounts enable row level security;
alter table public.seller_transfers enable row level security;
alter table public.settlement_records enable row level security;
alter table public.refund_records enable row level security;
alter table public.cod_collection_records enable row level security;
alter table public.financial_ledger_entries enable row level security;
alter table public.reconciliation_runs enable row level security;

-- PAYMENT ATTEMPTS: customer owner or operations/super admin (never content_admin)
drop policy if exists "Customers and ops admins read payment attempts" on public.payment_attempts;
create policy "Customers and ops admins read payment attempts"
  on public.payment_attempts for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- PAYMENT WEBHOOK EVENTS: super_admin & operations_admin diagnostics only (no customer/seller/content_admin)
drop policy if exists "Ops and super admins read webhook events" on public.payment_webhook_events;
create policy "Ops and super admins read webhook events"
  on public.payment_webhook_events for select
  using (public.is_operations_admin(auth.uid()));

-- SELLER SETTLEMENT ACCOUNTS: owning seller or operations/super admin (never content_admin)
drop policy if exists "Sellers and ops admins read settlement accounts" on public.seller_settlement_accounts;
create policy "Sellers and ops admins read settlement accounts"
  on public.seller_settlement_accounts for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Sellers submit own settlement account" on public.seller_settlement_accounts;
create policy "Sellers submit own settlement account"
  on public.seller_settlement_accounts for insert
  with check (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Sellers and ops admins update settlement accounts" on public.seller_settlement_accounts;
create policy "Sellers and ops admins update settlement accounts"
  on public.seller_settlement_accounts for update
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  )
  with check (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- SELLER TRANSFERS & SETTLEMENT RECORDS: owning seller or operations/super admin (never content_admin)
drop policy if exists "Sellers and ops admins read seller transfers" on public.seller_transfers;
create policy "Sellers and ops admins read seller transfers"
  on public.seller_transfers for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Sellers and ops admins read settlement records" on public.settlement_records;
create policy "Sellers and ops admins read settlement records"
  on public.settlement_records for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- REFUND RECORDS: customer owner, seller for own seller_order, or operations/super admin (never content_admin)
drop policy if exists "Order parties and ops admins read refund records" on public.refund_records;
create policy "Order parties and ops admins read refund records"
  on public.refund_records for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_id = auth.uid()
    )
    or exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- COD COLLECTION RECORDS: owning seller (read) or operations/super admin (read/update)
drop policy if exists "Sellers and ops admins read cod collection records" on public.cod_collection_records;
create policy "Sellers and ops admins read cod collection records"
  on public.cod_collection_records for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Ops admins update cod collection records" on public.cod_collection_records;
create policy "Ops admins update cod collection records"
  on public.cod_collection_records for update
  using (public.is_operations_admin(auth.uid()))
  with check (public.is_operations_admin(auth.uid()));

-- FINANCIAL LEDGER ENTRIES: owning seller (read own rows) or operations/super admin (read); writes server-only
drop policy if exists "Sellers and ops admins read financial ledger" on public.financial_ledger_entries;
create policy "Sellers and ops admins read financial ledger"
  on public.financial_ledger_entries for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- RECONCILIATION RUNS: operations/super admin only
drop policy if exists "Ops and super admins manage reconciliation runs" on public.reconciliation_runs;
create policy "Ops and super admins manage reconciliation runs"
  on public.reconciliation_runs for all
  using (public.is_operations_admin(auth.uid()))
  with check (public.is_operations_admin(auth.uid()));

-- Defense-in-depth table grants: revoke anon/public access; never allow authenticated DELETE on financial tables
revoke all on public.payment_gateway_config from public, anon, authenticated;
grant select, update on public.payment_gateway_config to authenticated;
grant all on public.payment_gateway_config to service_role;

revoke all on public.payment_attempts from public, anon, authenticated;
grant select on public.payment_attempts to authenticated;
grant all on public.payment_attempts to service_role;

revoke all on public.payment_webhook_events from public, anon, authenticated;
grant select on public.payment_webhook_events to authenticated;
grant all on public.payment_webhook_events to service_role;

revoke all on public.seller_settlement_accounts from public, anon, authenticated;
grant select, insert, update on public.seller_settlement_accounts to authenticated;
grant all on public.seller_settlement_accounts to service_role;

revoke all on public.seller_transfers from public, anon, authenticated;
grant select on public.seller_transfers to authenticated;
grant all on public.seller_transfers to service_role;

revoke all on public.settlement_records from public, anon, authenticated;
grant select on public.settlement_records to authenticated;
grant all on public.settlement_records to service_role;

revoke all on public.refund_records from public, anon, authenticated;
grant select on public.refund_records to authenticated;
grant all on public.refund_records to service_role;

revoke all on public.cod_collection_records from public, anon, authenticated;
grant select, update on public.cod_collection_records to authenticated;
grant all on public.cod_collection_records to service_role;

revoke all on public.financial_ledger_entries from public, anon, authenticated;
grant select on public.financial_ledger_entries to authenticated;
grant all on public.financial_ledger_entries to service_role;

revoke all on public.reconciliation_runs from public, anon, authenticated;
grant select, insert, update on public.reconciliation_runs to authenticated;
grant all on public.reconciliation_runs to service_role;

-- Extend seller_orders financial guard trigger from 007 so sellers cannot alter new paise columns,
-- while permitting trusted service_role Edge Functions and operations/super admins.
create or replace function public.guard_seller_order_financials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_can_administer boolean := (
    public.is_operations_admin(auth.uid())
    or public.is_trusted_sql_maintenance()
    or (
      auth.uid() is null
      and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    )
  );
begin
  if not v_can_administer then
    if new.subtotal is distinct from old.subtotal
       or new.commission_rate_snapshot is distinct from old.commission_rate_snapshot
       or new.commission_amount is distinct from old.commission_amount
       or new.seller_payout_amount is distinct from old.seller_payout_amount
       or new.subtotal_paise is distinct from old.subtotal_paise
       or new.discount_paise is distinct from old.discount_paise
       or new.shipping_paise is distinct from old.shipping_paise
       or new.tax_paise is distinct from old.tax_paise
       or new.commission_amount_paise is distinct from old.commission_amount_paise
       or new.seller_gross_paise is distinct from old.seller_gross_paise
       or new.seller_payable_paise is distinct from old.seller_payable_paise
       or new.gateway_fee_paise is distinct from old.gateway_fee_paise
       or new.adjustment_paise is distinct from old.adjustment_paise
       or new.refund_paise is distinct from old.refund_paise
       or new.reversal_paise is distinct from old.reversal_paise
       or new.settled_paise is distinct from old.settled_paise
       or new.outstanding_balance_paise is distinct from old.outstanding_balance_paise then
      raise exception 'Only authorized operations administrators or server settlement functions can alter seller order financial totals.';
    end if;

    if new.cod_reconciliation_status is distinct from old.cod_reconciliation_status then
      if not (
        new.fulfilment_status = 'cancelled'
        and old.fulfilment_status <> 'cancelled'
        and old.cod_reconciliation_status = 'awaiting_collection'
        and new.cod_reconciliation_status = 'not_applicable'
      ) then
        raise exception 'Only authorized operations administrators can alter COD reconciliation status.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- 7. UPDATE COD ORDER RPC & ADD SERVER-ONLY ONLINE RESERVATION/EXPIRY HELPERS
-- ============================================================================

-- Keep client-callable create_multi_vendor_order() strictly COD-only in Stage 7.8.1,
-- populating integer paise fields, COD collection records, and initial ledger entries.
create or replace function public.create_multi_vendor_order(
  p_shipping_address jsonb,
  p_payment_method text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order_id uuid;
  v_order_number text;
  v_subtotal_paise bigint := 0;
  v_shipping_paise bigint := 0;
  v_total_paise bigint := 0;
  v_threshold_paise bigint := 500000;
  v_flat_ship_paise bigint := 25000;
  v_item record;
  v_raw_item jsonb;
  v_product record;
  v_variant record;
  v_seller record;
  v_settings record;
  v_seller_group record;
  v_seller_order_id uuid;
  v_cod_record_id uuid;
  v_unit_price_paise bigint;
  v_qty integer;
  v_line_total_paise bigint;
  v_has_variants boolean;
  v_commission_paise bigint;
  v_payout_paise bigint;
  v_comm_bps integer;
  v_entry_group uuid := uuid_generate_v4();
begin
  if v_customer_id is null then
    raise exception 'Authentication required to place an order.';
  end if;

  if p_payment_method = 'online' then
    raise exception 'Direct client online checkout is disabled. Use the verified Razorpay Edge Function checkout flow.';
  end if;

  if p_payment_method <> 'cod' then
    raise exception 'Invalid payment method.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

  for v_raw_item in select * from jsonb_array_elements(p_items)
  loop
    if nullif(trim(coalesce(v_raw_item->>'product_id', '')), '') is null then
      raise exception 'Every order item must include a product_id.';
    end if;
    v_qty := (v_raw_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be positive.';
    end if;
  end loop;

  select * into v_settings from public.marketplace_settings where id = 1;
  if not found then
    raise exception 'Marketplace settings not initialized.';
  end if;

  if not v_settings.cod_enabled then
    raise exception 'Cash on Delivery is currently disabled.';
  end if;

  v_threshold_paise := round(v_settings.free_shipping_threshold * 100)::bigint;
  v_flat_ship_paise := round(v_settings.flat_shipping_fee * 100)::bigint;
  v_comm_bps := coalesce(v_settings.commission_basis_points, round(v_settings.commission_rate * 10000)::integer);

  create temp table if not exists _mv_order_lines (
    seller_id uuid not null,
    product_id uuid not null,
    variant_id uuid,
    product_name text not null,
    quantity integer not null,
    unit_price_paise bigint not null,
    line_total_paise bigint not null
  ) on commit drop;
  truncate table _mv_order_lines;

  for v_item in
    select
      (elem->>'product_id')::uuid as product_id,
      nullif(trim(coalesce(elem->>'variant_id', '')), '')::uuid as variant_id,
      sum((elem->>'quantity')::integer)::integer as total_quantity
    from jsonb_array_elements(p_items) as elem
    group by
      (elem->>'product_id')::uuid,
      nullif(trim(coalesce(elem->>'variant_id', '')), '')::uuid
    order by 1 asc, 2 asc nulls first
  loop
    v_qty := v_item.total_quantity;

    select * into v_product from public.products
    where id = v_item.product_id
    for update;

    if not found or v_product.approval_status <> 'approved' or v_product.is_published <> true then
      raise exception 'Product is not approved or published.';
    end if;

    if v_product.availability = 'Out of Stock' then
      raise exception 'Product % is out of stock.', v_product.name;
    end if;

    select * into v_seller from public.seller_profiles where id = v_product.seller_id;
    if not found or v_seller.account_status <> 'active' then
      raise exception 'Seller for % is currently unavailable.', v_product.name;
    end if;

    select exists (
      select 1 from public.product_variants where product_id = v_product.id
    ) into v_has_variants;

    if v_item.variant_id is not null then
      select * into v_variant from public.product_variants
      where id = v_item.variant_id and product_id = v_product.id
      for update;

      if not found then
        raise exception 'Invalid variant for product %.', v_product.name;
      end if;

      if v_variant.stock_quantity < v_qty then
        raise exception 'Insufficient variant stock for %.', v_product.name;
      end if;

      update public.product_variants
      set stock_quantity = stock_quantity - v_qty
      where id = v_variant.id;

      v_unit_price_paise := round(coalesce(v_variant.price_override, v_product.price) * 100)::bigint;
    else
      if v_has_variants then
        raise exception 'Please select a variant option for %.', v_product.name;
      end if;

      if v_product.stock_quantity < v_qty then
        raise exception 'Insufficient stock for %.', v_product.name;
      end if;

      update public.products
      set
        stock_quantity = stock_quantity - v_qty,
        availability = case
          when (stock_quantity - v_qty) <= 0 and availability = 'In Stock' then 'Out of Stock'
          else availability
        end
      where id = v_product.id;

      v_unit_price_paise := round(v_product.price * 100)::bigint;
    end if;

    v_line_total_paise := v_unit_price_paise * v_qty;
    v_subtotal_paise := v_subtotal_paise + v_line_total_paise;

    insert into _mv_order_lines (
      seller_id, product_id, variant_id, product_name, quantity, unit_price_paise, line_total_paise
    ) values (
      v_product.seller_id, v_product.id, v_item.variant_id, v_product.name, v_qty, v_unit_price_paise, v_line_total_paise
    );
  end loop;

  v_shipping_paise := case when v_subtotal_paise >= v_threshold_paise then 0 else v_flat_ship_paise end;
  v_total_paise := v_subtotal_paise + v_shipping_paise;
  v_order_number := 'NHJ-' || floor(100000 + random() * 900000)::text;

  insert into public.orders (
    order_number, customer_id, shipping_address,
    subtotal, shipping_amount, total_amount,
    currency, subtotal_paise, shipping_paise, total_paise,
    payment_method, payment_status, order_status, cod_lifecycle_status
  ) values (
    v_order_number, v_customer_id, p_shipping_address,
    (v_subtotal_paise / 100.0)::numeric(10, 2),
    (v_shipping_paise / 100.0)::numeric(10, 2),
    (v_total_paise / 100.0)::numeric(10, 2),
    'INR', v_subtotal_paise, v_shipping_paise, v_total_paise,
    'cod', 'cod_pending', 'confirmed', 'confirmed'
  )
  returning id into v_order_id;

  if v_shipping_paise > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, entry_type, direction, amount_paise,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order_id, 'shipping_allocation', 'credit', v_shipping_paise,
      'Customer shipping fee allocated to platform', v_order_number, v_customer_id
    );
  end if;

  for v_seller_group in
    select seller_id, sum(line_total_paise) as seller_subtotal_paise
    from _mv_order_lines
    group by seller_id
    order by seller_id
  loop
    v_commission_paise := round((v_seller_group.seller_subtotal_paise * v_comm_bps)::numeric / 10000.0)::bigint;
    v_payout_paise := v_seller_group.seller_subtotal_paise - v_commission_paise;

    insert into public.seller_orders (
      order_id, seller_id,
      subtotal, commission_rate_snapshot, commission_amount, seller_payout_amount,
      currency, subtotal_paise, commission_amount_paise, seller_gross_paise,
      seller_payable_paise, outstanding_balance_paise,
      fulfilment_status, cod_reconciliation_status
    ) values (
      v_order_id, v_seller_group.seller_id,
      (v_seller_group.seller_subtotal_paise / 100.0)::numeric(10, 2),
      v_settings.commission_rate,
      (v_commission_paise / 100.0)::numeric(10, 2),
      (v_payout_paise / 100.0)::numeric(10, 2),
      'INR', v_seller_group.seller_subtotal_paise, v_commission_paise,
      v_seller_group.seller_subtotal_paise, v_payout_paise, v_payout_paise,
      'pending', 'awaiting_collection'
    )
    returning id into v_seller_order_id;

    insert into public.order_items (
      order_id, seller_order_id, product_id, variant_id,
      product_name, quantity, unit_price, unit_price_paise, line_total_paise
    )
    select
      v_order_id, v_seller_order_id, product_id, variant_id,
      product_name, quantity,
      (unit_price_paise / 100.0)::numeric(10, 2),
      unit_price_paise, line_total_paise
    from _mv_order_lines
    where seller_id = v_seller_group.seller_id
    order by product_id asc, variant_id asc nulls first;

    insert into public.cod_collection_records (
      order_id, seller_order_id, seller_id,
      cod_order_value_paise, commission_paise, seller_payable_paise,
      outstanding_amount_paise, collection_status, reconciliation_status
    ) values (
      v_order_id, v_seller_order_id, v_seller_group.seller_id,
      v_seller_group.seller_subtotal_paise, v_commission_paise, v_payout_paise,
      v_payout_paise, 'confirmed', 'awaiting_collection'
    )
    returning id into v_cod_record_id;

    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, cod_record_id,
      entry_type, direction, amount_paise, commission_rate_bps,
      description, reference_id, created_by
    ) values
      (
        v_entry_group, v_order_id, v_seller_order_id, v_seller_group.seller_id, v_cod_record_id,
        'order_charge', 'debit', v_seller_group.seller_subtotal_paise, v_comm_bps,
        'COD seller product subtotal obligation', v_order_number, v_customer_id
      ),
      (
        v_entry_group, v_order_id, v_seller_order_id, v_seller_group.seller_id, v_cod_record_id,
        'commission_accrual', 'credit', v_commission_paise, v_comm_bps,
        'Platform commission accrued on COD product subtotal', v_order_number, v_customer_id
      ),
      (
        v_entry_group, v_order_id, v_seller_order_id, v_seller_group.seller_id, v_cod_record_id,
        'seller_payable_credit', 'credit', v_payout_paise, v_comm_bps,
        'Seller net share payable upon COD collection and remittance', v_order_number, v_customer_id
      );
  end loop;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (
    v_order_id,
    'confirmed',
    'Order initialized via COD',
    v_customer_id
  );

  return v_order_id;
end;
$$;

revoke all on function public.create_multi_vendor_order(jsonb, text, jsonb) from public, anon;
grant execute on function public.create_multi_vendor_order(jsonb, text, jsonb) to authenticated;

-- Server-only helper (invoked exclusively by trusted service_role Edge Functions in Stage 7.8.2+)
-- Creates or idempotently returns a pending_payment online order with a time-bounded inventory reservation.
create or replace function public.reserve_online_order_inventory(
  p_customer_id uuid,
  p_shipping_address jsonb,
  p_items jsonb,
  p_idempotency_key text,
  p_reservation_minutes integer default null
)
returns table (
  order_id uuid,
  order_number text,
  total_paise bigint,
  currency text,
  reservation_expires_at timestamptz,
  reused_existing boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.orders%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_subtotal_paise bigint := 0;
  v_shipping_paise bigint := 0;
  v_total_paise bigint := 0;
  v_threshold_paise bigint := 500000;
  v_flat_ship_paise bigint := 25000;
  v_ttl_minutes integer := 20;
  v_expires_at timestamptz;
  v_item record;
  v_raw_item jsonb;
  v_product record;
  v_variant record;
  v_seller record;
  v_settings record;
  v_seller_group record;
  v_seller_order_id uuid;
  v_unit_price_paise bigint;
  v_qty integer;
  v_line_total_paise bigint;
  v_has_variants boolean;
  v_commission_paise bigint;
  v_payout_paise bigint;
  v_comm_bps integer;
begin
  if p_customer_id is null then
    raise exception 'Customer ID is required.';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Checkout idempotency key is required.';
  end if;

  select * into v_existing
  from public.orders o
  where o.customer_id = p_customer_id
    and o.checkout_idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.order_status in ('expired', 'cancelled') then
      raise exception 'This checkout reservation has expired or been cancelled. Please start a fresh checkout.';
    end if;
    return query select
      v_existing.id,
      v_existing.order_number,
      v_existing.total_paise,
      v_existing.currency,
      v_existing.reservation_expires_at,
      true;
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

  for v_raw_item in select * from jsonb_array_elements(p_items)
  loop
    if nullif(trim(coalesce(v_raw_item->>'product_id', '')), '') is null then
      raise exception 'Every order item must include a product_id.';
    end if;
    v_qty := (v_raw_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be positive.';
    end if;
  end loop;

  select * into v_settings from public.marketplace_settings where id = 1;
  if not found then
    raise exception 'Marketplace settings not initialized.';
  end if;

  v_threshold_paise := round(v_settings.free_shipping_threshold * 100)::bigint;
  v_flat_ship_paise := round(v_settings.flat_shipping_fee * 100)::bigint;
  v_comm_bps := coalesce(v_settings.commission_basis_points, round(v_settings.commission_rate * 10000)::integer);
  v_ttl_minutes := greatest(5, least(120, coalesce(p_reservation_minutes, v_settings.payment_reservation_ttl_minutes, 20)));
  v_expires_at := now() + make_interval(mins => v_ttl_minutes);

  create temp table if not exists _mv_online_lines (
    seller_id uuid not null,
    product_id uuid not null,
    variant_id uuid,
    product_name text not null,
    quantity integer not null,
    unit_price_paise bigint not null,
    line_total_paise bigint not null
  ) on commit drop;
  truncate table _mv_online_lines;

  for v_item in
    select
      (elem->>'product_id')::uuid as product_id,
      nullif(trim(coalesce(elem->>'variant_id', '')), '')::uuid as variant_id,
      sum((elem->>'quantity')::integer)::integer as total_quantity
    from jsonb_array_elements(p_items) as elem
    group by
      (elem->>'product_id')::uuid,
      nullif(trim(coalesce(elem->>'variant_id', '')), '')::uuid
    order by 1 asc, 2 asc nulls first
  loop
    v_qty := v_item.total_quantity;

    select * into v_product from public.products
    where id = v_item.product_id
    for update;

    if not found or v_product.approval_status <> 'approved' or v_product.is_published <> true then
      raise exception 'Product is not approved or published.';
    end if;

    if v_product.availability = 'Out of Stock' then
      raise exception 'Product % is out of stock.', v_product.name;
    end if;

    select * into v_seller from public.seller_profiles where id = v_product.seller_id;
    if not found or v_seller.account_status <> 'active' then
      raise exception 'Seller for % is currently unavailable.', v_product.name;
    end if;

    select exists (
      select 1 from public.product_variants where product_id = v_product.id
    ) into v_has_variants;

    if v_item.variant_id is not null then
      select * into v_variant from public.product_variants
      where id = v_item.variant_id and product_id = v_product.id
      for update;

      if not found then
        raise exception 'Invalid variant for product %.', v_product.name;
      end if;

      if v_variant.stock_quantity < v_qty then
        raise exception 'Insufficient variant stock for %.', v_product.name;
      end if;

      update public.product_variants
      set stock_quantity = stock_quantity - v_qty
      where id = v_variant.id;

      v_unit_price_paise := round(coalesce(v_variant.price_override, v_product.price) * 100)::bigint;
    else
      if v_has_variants then
        raise exception 'Please select a variant option for %.', v_product.name;
      end if;

      if v_product.stock_quantity < v_qty then
        raise exception 'Insufficient stock for %.', v_product.name;
      end if;

      update public.products
      set
        stock_quantity = stock_quantity - v_qty,
        availability = case
          when (stock_quantity - v_qty) <= 0 and availability = 'In Stock' then 'Out of Stock'
          else availability
        end
      where id = v_product.id;

      v_unit_price_paise := round(v_product.price * 100)::bigint;
    end if;

    v_line_total_paise := v_unit_price_paise * v_qty;
    v_subtotal_paise := v_subtotal_paise + v_line_total_paise;

    insert into _mv_online_lines (
      seller_id, product_id, variant_id, product_name, quantity, unit_price_paise, line_total_paise
    ) values (
      v_product.seller_id, v_product.id, v_item.variant_id, v_product.name, v_qty, v_unit_price_paise, v_line_total_paise
    );
  end loop;

  v_shipping_paise := case when v_subtotal_paise >= v_threshold_paise then 0 else v_flat_ship_paise end;
  v_total_paise := v_subtotal_paise + v_shipping_paise;
  v_order_number := 'NHJ-' || floor(100000 + random() * 900000)::text;

  insert into public.orders (
    order_number, customer_id, shipping_address,
    subtotal, shipping_amount, total_amount,
    currency, checkout_idempotency_key,
    subtotal_paise, shipping_paise, total_paise,
    payment_method, payment_status, order_status,
    cod_lifecycle_status, reservation_expires_at
  ) values (
    v_order_number, p_customer_id, p_shipping_address,
    (v_subtotal_paise / 100.0)::numeric(10, 2),
    (v_shipping_paise / 100.0)::numeric(10, 2),
    (v_total_paise / 100.0)::numeric(10, 2),
    'INR', p_idempotency_key,
    v_subtotal_paise, v_shipping_paise, v_total_paise,
    'online', 'created', 'pending_payment',
    'not_applicable', v_expires_at
  )
  returning id into v_order_id;

  for v_seller_group in
    select seller_id, sum(line_total_paise) as seller_subtotal_paise
    from _mv_online_lines
    group by seller_id
    order by seller_id
  loop
    v_commission_paise := round((v_seller_group.seller_subtotal_paise * v_comm_bps)::numeric / 10000.0)::bigint;
    v_payout_paise := v_seller_group.seller_subtotal_paise - v_commission_paise;

    insert into public.seller_orders (
      order_id, seller_id,
      subtotal, commission_rate_snapshot, commission_amount, seller_payout_amount,
      currency, subtotal_paise, commission_amount_paise, seller_gross_paise,
      seller_payable_paise, outstanding_balance_paise,
      fulfilment_status, cod_reconciliation_status
    ) values (
      v_order_id, v_seller_group.seller_id,
      (v_seller_group.seller_subtotal_paise / 100.0)::numeric(10, 2),
      v_settings.commission_rate,
      (v_commission_paise / 100.0)::numeric(10, 2),
      (v_payout_paise / 100.0)::numeric(10, 2),
      'INR', v_seller_group.seller_subtotal_paise, v_commission_paise,
      v_seller_group.seller_subtotal_paise, v_payout_paise, v_payout_paise,
      'pending', 'not_applicable'
    )
    returning id into v_seller_order_id;

    insert into public.order_items (
      order_id, seller_order_id, product_id, variant_id,
      product_name, quantity, unit_price, unit_price_paise, line_total_paise
    )
    select
      v_order_id, v_seller_order_id, product_id, variant_id,
      product_name, quantity,
      (unit_price_paise / 100.0)::numeric(10, 2),
      unit_price_paise, line_total_paise
    from _mv_online_lines
    where seller_id = v_seller_group.seller_id
    order by product_id asc, variant_id asc nulls first;
  end loop;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (
    v_order_id,
    'pending_payment',
    'Online checkout inventory reserved until ' || to_char(v_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    p_customer_id
  );

  return query select v_order_id, v_order_number, v_total_paise, 'INR'::text, v_expires_at, false;
end;
$$;

revoke all on function public.reserve_online_order_inventory(uuid, jsonb, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_online_order_inventory(uuid, jsonb, jsonb, text, integer) to service_role;

-- Exact-once inventory release for failed or expired pending_payment online orders.
-- Invoked strictly by trusted service_role Edge Functions / scheduled cleanup jobs.
create or replace function public.release_expired_online_order_inventory(
  p_order_id uuid default null,
  p_target_status text default 'expired'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_so record;
  v_released_count integer := 0;
  v_next_order_status text;
  v_next_payment_status text;
begin
  if p_target_status not in ('expired', 'failed', 'cancelled') then
    raise exception 'Invalid target release status %.', p_target_status;
  end if;

  v_next_order_status := case when p_target_status = 'failed' then 'cancelled' else p_target_status end;
  v_next_payment_status := p_target_status;

  for v_order in
    select o.*
    from public.orders o
    where o.payment_method = 'online'
      and o.order_status = 'pending_payment'
      and o.payment_status in ('created', 'pending', 'failed')
      and o.reservation_released_at is null
      and (
        (p_order_id is not null and o.id = p_order_id)
        or (p_order_id is null and o.reservation_expires_at is not null and o.reservation_expires_at <= now())
      )
    order by o.created_at asc
    for update of o skip locked
  loop
    for v_so in
      select so.id
      from public.seller_orders so
      where so.order_id = v_order.id and so.fulfilment_status <> 'cancelled'
      order by so.id
      for update of so
    loop
      perform public.internal_restore_seller_order_inventory(v_so.id);

      update public.seller_orders
      set
        fulfilment_status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'Online payment reservation ' || p_target_status,
        outstanding_balance_paise = 0,
        updated_at = now()
      where id = v_so.id;
    end loop;

    update public.orders
    set
      order_status = v_next_order_status,
      payment_status = v_next_payment_status,
      reservation_released_at = now(),
      cancelled_at = coalesce(cancelled_at, now()),
      cancellation_reason = coalesce(cancellation_reason, 'Online payment reservation ' || p_target_status),
      updated_at = now()
    where id = v_order.id;

    update public.payments
    set
      status = case when status in ('created', 'pending') then v_next_payment_status else status end,
      updated_at = now()
    where order_id = v_order.id and status in ('created', 'pending');

    insert into public.order_status_history (order_id, status, note)
    values (
      v_order.id,
      v_next_order_status,
      'Released reserved online checkout inventory exact-once (' || p_target_status || ')'
    );

    v_released_count := v_released_count + 1;
  end loop;

  return v_released_count;
end;
$$;

revoke all on function public.release_expired_online_order_inventory(uuid, text) from public, anon, authenticated;
grant execute on function public.release_expired_online_order_inventory(uuid, text) to service_role;

commit;
