-- NOHAJ Marketplace — Stage 7.8.4: Razorpay Route, Seller Onboarding & Settlements
-- Migration: 011_razorpay_route_and_settlements.sql
-- Depends on: 008_payment_and_settlement_foundation.sql, 009, 010_refund_and_cancellation_accounting.sql.
-- Safe to rerun: Yes (forward-only, transaction-wrapped, precondition-checked, idempotent).
--
-- Scope:
--   - Extends seller_settlement_accounts with registered address, agreement acceptance,
--     Razorpay stakeholder/activation tracking, and verification requirements metadata.
--   - Enforces that sellers CANNOT be marked 'active' or payouts_enabled=true until
--     Razorpay Linked Account + Route product activation is verified.
--   - Adds seller_transfer_reversals table and exact-once financial ledger partial unique indexes.
--   - Implements seller onboarding RPCs, Route transfer reservation/finalization/reversal RPCs,
--     payable balance calculator (historical snapshot only, excludes COD), and summary RPCs.
--   - Keeps RAZORPAY_ROUTE_ENABLED=false and route_approval_status='not_approved' by default.
--   - Strictly excludes content_admin, customers, and unverified sellers from settlement controls.

begin;

-- ============================================================================
-- 0. PRECONDITION CHECKS
-- ============================================================================

do $$
begin
  if to_regclass('public.payment_gateway_config') is null
     or to_regclass('public.seller_settlement_accounts') is null
     or to_regclass('public.seller_transfers') is null
     or to_regclass('public.settlement_records') is null
     or to_regclass('public.refund_records') is null
     or to_regclass('public.refund_seller_adjustments') is null
     or to_regclass('public.cod_collection_records') is null
     or to_regclass('public.financial_ledger_entries') is null
     or to_regclass('public.reconciliation_runs') is null
     or to_regprocedure('public.is_operations_admin(uuid)') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'Precondition failed: migrations 001 through 010 must be applied before 011_razorpay_route_and_settlements.sql.';
  end if;
end $$;

-- ============================================================================
-- 1. EXTEND SELLER_SETTLEMENT_ACCOUNTS & GUARD AGAINST PREMATURE ACTIVATION
-- ============================================================================

alter table public.seller_settlement_accounts
  add column if not exists registered_address jsonb,
  add column if not exists agreement_accepted boolean not null default false,
  add column if not exists agreement_accepted_at timestamptz,
  add column if not exists agreement_version text,
  add column if not exists razorpay_stakeholder_id text,
  add column if not exists razorpay_raw_activation_status text,
  add column if not exists kyc_requirements jsonb,
  add column if not exists rejection_reason text,
  add column if not exists last_synced_at timestamptz;

create or replace function public.guard_seller_settlement_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service_role boolean := (
    public.is_trusted_sql_maintenance()
    or (
      auth.uid() is null
      and coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    )
  );
  v_can_administer boolean := (
    public.is_operations_admin(auth.uid())
    or v_is_service_role
  );
begin
  if not v_can_administer then
    if tg_op = 'INSERT' then
      if new.kyc_status not in ('not_started', 'submitted')
         or new.route_onboarding_status not in ('not_started', 'submitted')
         or new.payouts_enabled = true
         or new.razorpay_linked_account_id is not null
         or new.razorpay_product_id is not null
         or new.razorpay_stakeholder_id is not null
         or new.razorpay_raw_activation_status is not null
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
         or new.razorpay_stakeholder_id is distinct from old.razorpay_stakeholder_id
         or new.razorpay_raw_activation_status is distinct from old.razorpay_raw_activation_status
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at then
        raise exception 'Only authorized operations administrators or server settlement functions can modify Route account identifiers or payout eligibility.';
      end if;
    end if;
  end if;

  -- Never allow marking a seller active or payouts_enabled=true without verified Razorpay approval
  if (new.route_onboarding_status = 'active' or new.payouts_enabled = true) then
    if nullif(trim(coalesce(new.razorpay_linked_account_id, '')), '') is null
       or coalesce(new.razorpay_raw_activation_status, '') <> 'activated' then
      raise exception 'Seller cannot be marked active or payout-enabled until Razorpay Linked Account approval status is verified as activated.';
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
-- 2. EXTEND SELLER_TRANSFERS + ADD SELLER_TRANSFER_REVERSALS & LEDGER INDEXES
-- ============================================================================

alter table public.seller_transfers
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists last_error_code text,
  add column if not exists initiated_by uuid references public.profiles(id),
  add column if not exists settlement_id text,
  add column if not exists provider_settlement_utr text,
  add column if not exists last_reconciled_at timestamptz;

alter table public.seller_transfers drop constraint if exists seller_transfers_settlement_status_check;
alter table public.seller_transfers
  add constraint seller_transfers_settlement_status_check
  check (settlement_status in ('pending', 'scheduled', 'on_hold', 'settled', 'failed', 'reversed'));

create table if not exists public.seller_transfer_reversals (
  id uuid primary key default uuid_generate_v4(),
  seller_transfer_id uuid not null references public.seller_transfers(id) on delete cascade,
  seller_order_id uuid not null references public.seller_orders(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  refund_id uuid references public.refund_records(id) on delete set null,
  seller_id uuid not null references public.seller_profiles(id),
  provider_reversal_id text unique,
  idempotency_key text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  reason text not null,
  failure_reason text,
  initiated_by uuid references public.profiles(id),
  processed_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seller_transfer_reversals_transfer
  on public.seller_transfer_reversals(seller_transfer_id);
create index if not exists idx_seller_transfer_reversals_seller
  on public.seller_transfer_reversals(seller_id);
create index if not exists idx_seller_transfer_reversals_refund
  on public.seller_transfer_reversals(refund_id)
  where refund_id is not null;

alter table public.seller_transfer_reversals enable row level security;

drop policy if exists "Sellers and ops admins read transfer reversals" on public.seller_transfer_reversals;
create policy "Sellers and ops admins read transfer reversals"
  on public.seller_transfer_reversals for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

revoke all on public.seller_transfer_reversals from public, anon, authenticated;
grant select on public.seller_transfer_reversals to authenticated;
grant all on public.seller_transfer_reversals to service_role;

-- Exact-once append-only ledger unique constraints for Route transfers & reversals
create unique index if not exists idx_ledger_unique_transfer_type
  on public.financial_ledger_entries(transfer_id, entry_type)
  where transfer_id is not null
    and entry_type in ('transfer_initiated', 'transfer_settled');

create unique index if not exists idx_ledger_unique_reversal_ref
  on public.financial_ledger_entries(transfer_id, entry_type, reference_id)
  where transfer_id is not null
    and entry_type = 'transfer_reversal'
    and reference_id is not null;

-- Extend audit_logs INSERT policy for settlement & Route target tables
drop policy if exists "Operations admins insert audit logs" on public.audit_logs;
create policy "Operations admins insert audit logs"
  on public.audit_logs for insert
  with check (
    actor_id = auth.uid()
    and public.is_operations_admin(auth.uid())
    and target_table in (
      'seller_profiles', 'orders', 'seller_orders', 'seller_applications',
      'returns', 'marketplace_settings', 'refund_records', 'refund_items',
      'cod_collection_records', 'financial_ledger_entries',
      'seller_settlement_accounts', 'seller_transfers',
      'seller_transfer_reversals', 'settlement_records',
      'reconciliation_runs', 'payment_gateway_config'
    )
  );

-- ============================================================================
-- 3. SELLER SETTLEMENT ONBOARDING RPCs (PRIVATE STORAGE + SERVER VALIDATED)
-- ============================================================================

create or replace function public.submit_seller_settlement_onboarding(
  p_legal_business_name text,
  p_business_type text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_pan_last4 text,
  p_gstin text,
  p_beneficiary_name text,
  p_bank_account_last4 text,
  p_bank_ifsc text,
  p_settlement_destination_type text,
  p_registered_address jsonb,
  p_kyc_storage_paths text[],
  p_seller_consent_accepted boolean,
  p_agreement_accepted boolean,
  p_agreement_version text default 'nohaj-route-seller-v1'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_seller public.seller_profiles%rowtype;
  v_account_id uuid;
  v_path text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_seller
  from public.seller_profiles
  where user_id = v_uid
  for update;

  if not found then
    raise exception 'Seller profile not found.';
  end if;

  if coalesce(p_seller_consent_accepted, false) = false or coalesce(p_agreement_accepted, false) = false then
    raise exception 'Seller consent and marketplace settlement agreement acceptance are required.';
  end if;

  if nullif(trim(coalesce(p_legal_business_name, '')), '') is null
     or nullif(trim(coalesce(p_contact_name, '')), '') is null
     or nullif(trim(coalesce(p_contact_email, '')), '') is null
     or nullif(trim(coalesce(p_contact_phone, '')), '') is null
     or nullif(trim(coalesce(p_beneficiary_name, '')), '') is null
     or nullif(trim(coalesce(p_bank_ifsc, '')), '') is null then
    raise exception 'Legal business name, contact info, beneficiary name, and bank IFSC are required.';
  end if;

  if coalesce(p_pan_last4, '') !~ '^[A-Z0-9]{4}$' then
    raise exception 'PAN last 4 characters must be 4 uppercase alphanumeric characters.';
  end if;

  if coalesce(p_bank_account_last4, '') !~ '^[0-9]{4}$' then
    raise exception 'Bank account last 4 digits must be 4 numeric digits.';
  end if;

  if coalesce(p_settlement_destination_type, 'bank_account') not in ('bank_account', 'upi_vpa') then
    raise exception 'Invalid settlement destination type.';
  end if;

  -- Enforce that all uploaded KYC document paths sit strictly inside the caller's private folder
  if p_kyc_storage_paths is not null then
    foreach v_path in array p_kyc_storage_paths loop
      if split_part(v_path, '/', 1) <> v_uid::text then
        raise exception 'Invalid KYC document storage path ownership.';
      end if;
    end loop;
  end if;

  insert into public.seller_settlement_accounts (
    seller_id,
    legal_business_name,
    business_type,
    contact_name,
    contact_email,
    contact_phone,
    pan_last4,
    gstin,
    beneficiary_name,
    bank_account_last4,
    bank_ifsc,
    settlement_destination_type,
    registered_address,
    kyc_storage_paths,
    seller_consent_accepted,
    seller_consent_accepted_at,
    agreement_accepted,
    agreement_accepted_at,
    agreement_version,
    kyc_status,
    route_onboarding_status,
    payouts_enabled,
    rejection_reason
  ) values (
    v_seller.id,
    trim(p_legal_business_name),
    nullif(trim(coalesce(p_business_type, '')), ''),
    trim(p_contact_name),
    trim(p_contact_email),
    trim(p_contact_phone),
    upper(trim(p_pan_last4)),
    nullif(upper(trim(coalesce(p_gstin, ''))), ''),
    trim(p_beneficiary_name),
    trim(p_bank_account_last4),
    upper(trim(p_bank_ifsc)),
    coalesce(p_settlement_destination_type, 'bank_account'),
    p_registered_address,
    coalesce(p_kyc_storage_paths, '{}'::text[]),
    true,
    now(),
    true,
    now(),
    coalesce(nullif(trim(p_agreement_version), ''), 'nohaj-route-seller-v1'),
    'submitted',
    'submitted',
    false,
    null
  )
  on conflict (seller_id) do update set
    legal_business_name = excluded.legal_business_name,
    business_type = excluded.business_type,
    contact_name = excluded.contact_name,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    pan_last4 = excluded.pan_last4,
    gstin = excluded.gstin,
    beneficiary_name = excluded.beneficiary_name,
    bank_account_last4 = excluded.bank_account_last4,
    bank_ifsc = excluded.bank_ifsc,
    settlement_destination_type = excluded.settlement_destination_type,
    registered_address = excluded.registered_address,
    kyc_storage_paths = case
      when cardinality(excluded.kyc_storage_paths) > 0 then excluded.kyc_storage_paths
      else public.seller_settlement_accounts.kyc_storage_paths
    end,
    seller_consent_accepted = true,
    seller_consent_accepted_at = coalesce(public.seller_settlement_accounts.seller_consent_accepted_at, now()),
    agreement_accepted = true,
    agreement_accepted_at = coalesce(public.seller_settlement_accounts.agreement_accepted_at, now()),
    agreement_version = excluded.agreement_version,
    kyc_status = case
      when public.seller_settlement_accounts.route_onboarding_status = 'active' then public.seller_settlement_accounts.kyc_status
      else 'submitted'
    end,
    route_onboarding_status = case
      when public.seller_settlement_accounts.route_onboarding_status = 'active' then 'active'
      else 'submitted'
    end,
    rejection_reason = null,
    updated_at = now()
  returning id into v_account_id;

  update public.seller_profiles
  set payout_verification_status = case
    when payout_verification_status = 'verified' then 'verified'
    else 'pending'
  end
  where id = v_seller.id;

  return v_account_id;
end;
$$;

revoke all on function public.submit_seller_settlement_onboarding(
  text, text, text, text, text, text, text, text, text, text, text, jsonb, text[], boolean, boolean, text
) from public, anon;
grant execute on function public.submit_seller_settlement_onboarding(
  text, text, text, text, text, text, text, text, text, text, text, jsonb, text[], boolean, boolean, text
) to authenticated;

create or replace function public.review_seller_settlement_onboarding(
  p_account_id uuid,
  p_decision text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_acct public.seller_settlement_accounts%rowtype;
begin
  if not public.is_operations_admin(v_uid) then
    raise exception 'Forbidden: only operations or super administrators may review seller settlement onboarding.';
  end if;

  if p_decision not in ('verification_pending', 'action_required', 'rejected', 'suspended') then
    raise exception 'Admin manual review supports verification_pending, action_required, rejected, or suspended. Active status requires Razorpay Route verification.';
  end if;

  select * into v_acct
  from public.seller_settlement_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'Seller settlement account not found.';
  end if;

  if p_decision in ('rejected', 'action_required') and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'Notes/reason are required when requesting clarification or rejecting onboarding.';
  end if;

  update public.seller_settlement_accounts
  set
    kyc_status = p_decision,
    route_onboarding_status = p_decision,
    payouts_enabled = false,
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    rejection_reason = case when p_decision in ('rejected', 'action_required', 'suspended') then trim(p_notes) else null end,
    reviewed_by = v_uid,
    reviewed_at = now(),
    updated_at = now()
  where id = v_acct.id;

  update public.seller_profiles
  set payout_verification_status = case
    when p_decision = 'verification_pending' then 'pending'
    else 'unverified'
  end
  where id = v_acct.seller_id;

  insert into public.audit_logs (actor_id, action, target_table, target_id, details)
  values (
    v_uid,
    'REVIEW_SELLER_SETTLEMENT_ONBOARDING',
    'seller_settlement_accounts',
    v_acct.id,
    jsonb_build_object('decision', p_decision, 'notes', p_notes)
  );
end;
$$;

revoke all on function public.review_seller_settlement_onboarding(uuid, text, text) from public, anon;
grant execute on function public.review_seller_settlement_onboarding(uuid, text, text) to authenticated;

create or replace function public.sync_linked_account_from_route(
  p_account_id uuid,
  p_razorpay_linked_account_id text,
  p_razorpay_product_id text default null,
  p_razorpay_stakeholder_id text default null,
  p_raw_activation_status text default null,
  p_kyc_requirements jsonb default null,
  p_actor_id uuid default null
)
returns public.seller_settlement_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acct public.seller_settlement_accounts%rowtype;
  v_mapped_status text;
  v_payouts_enabled boolean := false;
  v_raw text := lower(trim(coalesce(p_raw_activation_status, 'under_review')));
begin
  select * into v_acct
  from public.seller_settlement_accounts
  where id = p_account_id
     or (p_razorpay_linked_account_id is not null and razorpay_linked_account_id = p_razorpay_linked_account_id)
  for update;

  if not found then
    raise exception 'Seller settlement account not found for Route sync.';
  end if;

  if v_raw in ('activated', 'active') then
    v_mapped_status := 'active';
    v_raw := 'activated';
    v_payouts_enabled := true;
  elsif v_raw in ('needs_clarification', 'action_required') then
    v_mapped_status := 'action_required';
    v_payouts_enabled := false;
  elsif v_raw in ('suspended') then
    v_mapped_status := 'suspended';
    v_payouts_enabled := false;
  elsif v_raw in ('rejected', 'failed') then
    v_mapped_status := 'rejected';
    v_payouts_enabled := false;
  else
    v_mapped_status := 'verification_pending';
    v_payouts_enabled := false;
  end if;

  update public.seller_settlement_accounts
  set
    razorpay_linked_account_id = coalesce(nullif(trim(p_razorpay_linked_account_id), ''), razorpay_linked_account_id),
    razorpay_product_id = coalesce(nullif(trim(p_razorpay_product_id), ''), razorpay_product_id),
    razorpay_stakeholder_id = coalesce(nullif(trim(p_razorpay_stakeholder_id), ''), razorpay_stakeholder_id),
    razorpay_raw_activation_status = v_raw,
    kyc_status = v_mapped_status,
    route_onboarding_status = v_mapped_status,
    payouts_enabled = v_payouts_enabled,
    kyc_requirements = coalesce(p_kyc_requirements, kyc_requirements),
    reviewed_by = coalesce(p_actor_id, reviewed_by),
    reviewed_at = coalesce(reviewed_at, now()),
    last_synced_at = now(),
    updated_at = now()
  where id = v_acct.id
  returning * into v_acct;

  update public.seller_profiles
  set payout_verification_status = case
    when v_payouts_enabled then 'verified'
    when v_mapped_status in ('verification_pending', 'submitted', 'action_required') then 'pending'
    else 'unverified'
  end
  where id = v_acct.seller_id;

  return v_acct;
end;
$$;

revoke all on function public.sync_linked_account_from_route(uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.sync_linked_account_from_route(uuid, text, text, text, text, jsonb, uuid) to service_role;

-- ============================================================================
-- 4. PAYABLE BALANCE CALCULATOR & ROUTE TRANSFER RESERVATION / FINALIZATION
-- ============================================================================

create or replace function public.calculate_seller_order_transferable_paise(
  p_seller_order_id uuid
)
returns table (
  seller_order_id uuid,
  order_id uuid,
  seller_id uuid,
  gross_subtotal_paise bigint,
  commission_paise bigint,
  refund_reversed_payable_paise bigint,
  net_seller_payable_paise bigint,
  committed_transfer_paise bigint,
  available_transferable_paise bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.seller_orders%rowtype;
  v_order public.orders%rowtype;
  v_pay public.payments%rowtype;
  v_refund_payable_reversed bigint := 0;
  v_net_payable bigint := 0;
  v_committed bigint := 0;
begin
  select * into v_so
  from public.seller_orders
  where id = p_seller_order_id;

  if not found then
    raise exception 'Seller order not found.';
  end if;

  select * into v_order
  from public.orders
  where id = v_so.order_id;

  if not found or v_order.payment_method <> 'online' then
    return query select
      v_so.id, v_so.order_id, v_so.seller_id,
      v_so.subtotal_paise, v_so.commission_amount_paise,
      0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  select * into v_pay
  from public.payments
  where public.payments.order_id = v_order.id
  order by created_at desc
  limit 1;

  if not found or v_pay.captured_paise <= 0 or v_order.payment_status not in ('captured', 'paid', 'partially_refunded') then
    return query select
      v_so.id, v_so.order_id, v_so.seller_id,
      v_so.subtotal_paise, v_so.commission_amount_paise,
      0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  if v_so.fulfilment_status = 'cancelled' then
    return query select
      v_so.id, v_so.order_id, v_so.seller_id,
      v_so.subtotal_paise, v_so.commission_amount_paise,
      0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  select coalesce(sum(rsa.seller_payable_reversed_paise), 0)::bigint
  into v_refund_payable_reversed
  from public.refund_seller_adjustments rsa
  join public.refund_records rr on rr.id = rsa.refund_id
  where rsa.seller_order_id = v_so.id
    and rr.status <> 'failed'
    and coalesce(rr.request_status, 'completed') <> 'rejected';

  -- Historical seller_payable_paise already deducts historical 12% commission snapshot.
  -- Do NOT deduct gateway fees or shipping unless explicitly agreed in adjustment_paise.
  v_net_payable := greatest(
    0::bigint,
    v_so.seller_payable_paise - v_refund_payable_reversed + coalesce(v_so.adjustment_paise, 0)
  );

  select coalesce(sum(st.amount_paise - st.reversed_paise), 0)::bigint
  into v_committed
  from public.seller_transfers st
  where st.seller_order_id = v_so.id
    and st.status in ('pending', 'created', 'processed', 'on_hold', 'partially_reversed');

  return query select
    v_so.id,
    v_so.order_id,
    v_so.seller_id,
    v_so.subtotal_paise,
    v_so.commission_amount_paise,
    v_refund_payable_reversed,
    v_net_payable,
    v_committed,
    greatest(0::bigint, v_net_payable - v_committed);
end;
$$;

revoke all on function public.calculate_seller_order_transferable_paise(uuid) from public, anon, authenticated;
grant execute on function public.calculate_seller_order_transferable_paise(uuid) to service_role;

create or replace function public.reserve_seller_route_transfer(
  p_actor_id uuid,
  p_seller_order_id uuid,
  p_amount_paise bigint default null,
  p_transfer_id uuid default null,
  p_on_hold boolean default false,
  p_hold_until timestamptz default null,
  p_idempotency_key text default null
)
returns table (
  transfer_id uuid,
  seller_order_id uuid,
  order_id uuid,
  payment_id uuid,
  provider_payment_id text,
  seller_id uuid,
  settlement_account_id uuid,
  linked_account_id text,
  amount_paise bigint,
  currency text,
  on_hold boolean,
  hold_until timestamptz,
  already_initiated boolean,
  provider_transfer_id text,
  transfer_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.payment_gateway_config%rowtype;
  v_so public.seller_orders%rowtype;
  v_order public.orders%rowtype;
  v_pay public.payments%rowtype;
  v_acct public.seller_settlement_accounts%rowtype;
  v_existing public.seller_transfers%rowtype;
  v_available bigint := 0;
  v_target_amount bigint := 0;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_new_id uuid;
begin
  if not public.is_operations_admin(p_actor_id) then
    raise exception 'Forbidden: only operations or super administrators may initiate seller transfers.';
  end if;

  if v_idem is null then
    raise exception 'idempotency_key is required.';
  end if;

  select * into v_cfg
  from public.payment_gateway_config
  where id = 1;

  if not found or v_cfg.razorpay_route_enabled = false or v_cfg.route_approval_status <> 'approved' then
    raise exception 'Razorpay Route is disabled or not yet approved.';
  end if;

  -- Check idempotent replay first
  select * into v_existing
  from public.seller_transfers
  where idempotency_key = v_idem
  for update;

  if found then
    select * into v_pay from public.payments where id = v_existing.payment_id;
    select * into v_acct from public.seller_settlement_accounts where id = v_existing.settlement_account_id;
    return query select
      v_existing.id,
      v_existing.seller_order_id,
      v_existing.order_id,
      v_existing.payment_id,
      v_pay.provider_payment_id,
      v_existing.seller_id,
      v_existing.settlement_account_id,
      v_acct.razorpay_linked_account_id,
      v_existing.amount_paise,
      v_existing.currency,
      v_existing.on_hold,
      v_existing.hold_until,
      true,
      v_existing.provider_transfer_id,
      v_existing.status;
    return;
  end if;

  select * into v_so
  from public.seller_orders
  where id = p_seller_order_id
  for update;

  if not found then
    raise exception 'Seller order not found.';
  end if;

  select * into v_order
  from public.orders
  where id = v_so.order_id
  for update;

  if v_order.payment_method <> 'online' then
    raise exception 'COD seller orders cannot be routed through Razorpay Route transfers.';
  end if;

  if v_order.payment_status not in ('captured', 'paid', 'partially_refunded') then
    raise exception 'Customer payment is not captured or eligible for Route transfer.';
  end if;

  if v_so.fulfilment_status = 'cancelled' then
    raise exception 'Cancelled seller orders are not eligible for settlement transfers.';
  end if;

  select * into v_pay
  from public.payments
  where public.payments.order_id = v_order.id
  order by created_at desc
  limit 1;

  if not found or v_pay.captured_paise <= 0 or nullif(trim(coalesce(v_pay.provider_payment_id, '')), '') is null then
    raise exception 'Verified Razorpay captured payment is missing for this order.';
  end if;

  select * into v_acct
  from public.seller_settlement_accounts
  where seller_id = v_so.seller_id
  for update;

  if not found
     or v_acct.route_onboarding_status <> 'active'
     or v_acct.payouts_enabled = false
     or nullif(trim(coalesce(v_acct.razorpay_linked_account_id, '')), '') is null then
    raise exception 'Seller Linked Account is not active or verified for Razorpay Route payouts.';
  end if;

  select available_transferable_paise into v_available
  from public.calculate_seller_order_transferable_paise(v_so.id);

  if p_transfer_id is not null then
    select * into v_existing
    from public.seller_transfers
    where id = p_transfer_id and seller_order_id = v_so.id
    for update;

    if not found then
      raise exception 'Transfer record not found for retry.';
    end if;

    if v_existing.status <> 'failed' then
      return query select
        v_existing.id, v_existing.seller_order_id, v_existing.order_id, v_existing.payment_id,
        v_pay.provider_payment_id, v_existing.seller_id, v_existing.settlement_account_id,
        v_acct.razorpay_linked_account_id, v_existing.amount_paise, v_existing.currency,
        v_existing.on_hold, v_existing.hold_until, true, v_existing.provider_transfer_id, v_existing.status;
      return;
    end if;

    if v_existing.amount_paise > v_available then
      raise exception 'Retry transfer amount exceeds remaining seller payable balance.';
    end if;

    update public.seller_transfers
    set
      status = 'pending',
      settlement_status = 'pending',
      idempotency_key = v_idem,
      retry_count = retry_count + 1,
      failure_reason = null,
      last_error_code = null,
      initiated_by = p_actor_id,
      on_hold = coalesce(p_on_hold, on_hold),
      hold_until = coalesce(p_hold_until, hold_until),
      updated_at = now()
    where id = v_existing.id
    returning id into v_new_id;

    return query select
      v_new_id, v_so.id, v_order.id, v_pay.id, v_pay.provider_payment_id,
      v_so.seller_id, v_acct.id, v_acct.razorpay_linked_account_id,
      v_existing.amount_paise, 'INR', coalesce(p_on_hold, v_existing.on_hold),
      coalesce(p_hold_until, v_existing.hold_until), false, null::text, 'pending';
    return;
  end if;

  v_target_amount := coalesce(p_amount_paise, v_available);
  if v_target_amount <= 0 or v_target_amount > v_available then
    raise exception 'Insufficient available seller payable balance for requested transfer amount.';
  end if;

  insert into public.seller_transfers (
    seller_order_id,
    order_id,
    payment_id,
    seller_id,
    settlement_account_id,
    idempotency_key,
    amount_paise,
    currency,
    status,
    on_hold,
    hold_until,
    settlement_status,
    initiated_by
  ) values (
    v_so.id,
    v_order.id,
    v_pay.id,
    v_so.seller_id,
    v_acct.id,
    v_idem,
    v_target_amount,
    'INR',
    'pending',
    coalesce(p_on_hold, false),
    p_hold_until,
    'pending',
    p_actor_id
  )
  returning id into v_new_id;

  return query select
    v_new_id,
    v_so.id,
    v_order.id,
    v_pay.id,
    v_pay.provider_payment_id,
    v_so.seller_id,
    v_acct.id,
    v_acct.razorpay_linked_account_id,
    v_target_amount,
    'INR',
    coalesce(p_on_hold, false),
    p_hold_until,
    false,
    null::text,
    'pending';
end;
$$;

revoke all on function public.reserve_seller_route_transfer(uuid, uuid, bigint, uuid, boolean, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reserve_seller_route_transfer(uuid, uuid, bigint, uuid, boolean, timestamptz, text) to service_role;

create or replace function public.finalize_seller_route_transfer(
  p_transfer_id uuid default null,
  p_provider_transfer_id text default null,
  p_next_status text default 'created',
  p_settlement_id text default null,
  p_settlement_utr text default null,
  p_failure_reason text default null,
  p_error_code text default null,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  transfer_id uuid,
  seller_order_id uuid,
  transfer_status text,
  settlement_status text,
  ignored_out_of_order boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_st public.seller_transfers%rowtype;
  v_so public.seller_orders%rowtype;
  v_target text := lower(trim(coalesce(p_next_status, 'created')));
begin
  if p_transfer_id is not null then
    select * into v_st from public.seller_transfers where id = p_transfer_id for update;
  elsif p_provider_transfer_id is not null then
    select * into v_st from public.seller_transfers where provider_transfer_id = p_provider_transfer_id for update;
  end if;

  if not found then
    raise exception 'Seller transfer record not found.';
  end if;

  if p_provider_transfer_id is not null and v_st.provider_transfer_id is null then
    update public.seller_transfers
    set provider_transfer_id = p_provider_transfer_id
    where id = v_st.id;
    v_st.provider_transfer_id := p_provider_transfer_id;
  end if;

  -- Protect terminal states from stale/out-of-order regressions
  if v_st.status in ('reversed', 'partially_reversed') and v_target in ('pending', 'created', 'processed', 'failed') then
    return query select v_st.id, v_st.seller_order_id, v_st.status, v_st.settlement_status, true;
    return;
  end if;

  if v_st.settlement_status = 'settled' and v_target in ('pending', 'created', 'processed', 'on_hold', 'failed') then
    return query select v_st.id, v_st.seller_order_id, v_st.status, v_st.settlement_status, true;
    return;
  end if;

  if v_target = 'pending' then
    update public.seller_transfers
    set metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        last_reconciled_at = now(),
        updated_at = now()
    where id = v_st.id
    returning * into v_st;
    return query select v_st.id, v_st.seller_order_id, v_st.status, v_st.settlement_status, false;
    return;
  end if;

  if v_target = 'failed' then
    update public.seller_transfers
    set status = 'failed',
        settlement_status = 'failed',
        failure_reason = p_failure_reason,
        last_error_code = p_error_code,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        last_reconciled_at = now(),
        updated_at = now()
    where id = v_st.id
    returning * into v_st;
    return query select v_st.id, v_st.seller_order_id, v_st.status, v_st.settlement_status, false;
    return;
  end if;

  if v_target in ('created', 'on_hold', 'processed') then
    update public.seller_transfers
    set status = case when v_target = 'on_hold' or (v_st.on_hold and v_target = 'created') then 'on_hold' else v_target end,
        settlement_status = case
          when v_target = 'on_hold' or (v_st.on_hold and v_target = 'created') then 'on_hold'
          when v_target = 'processed' then 'scheduled'
          else 'pending'
        end,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        last_reconciled_at = now(),
        updated_at = now()
    where id = v_st.id
    returning * into v_st;

    insert into public.financial_ledger_entries (
      order_id, seller_order_id, seller_id, payment_id, transfer_id,
      entry_type, direction, amount_paise, currency, description, reference_id, created_by
    ) values (
      v_st.order_id, v_st.seller_order_id, v_st.seller_id, v_st.payment_id, v_st.id,
      'transfer_initiated', 'debit', v_st.amount_paise, 'INR',
      'Razorpay Route transfer initiated to seller Linked Account',
      v_st.provider_transfer_id, p_actor_id
    )
    on conflict (transfer_id, entry_type)
    where transfer_id is not null and entry_type in ('transfer_initiated', 'transfer_settled')
    do nothing;

    return query select v_st.id, v_st.seller_order_id, v_st.status, v_st.settlement_status, false;
    return;
  end if;

  if v_target = 'settled' then
    select * into v_so from public.seller_orders where id = v_st.seller_order_id for update;

    -- Ensure transfer_initiated entry exists if webhook jumped directly to settled
    insert into public.financial_ledger_entries (
      order_id, seller_order_id, seller_id, payment_id, transfer_id,
      entry_type, direction, amount_paise, currency, description, reference_id, created_by
    ) values (
      v_st.order_id, v_st.seller_order_id, v_st.seller_id, v_st.payment_id, v_st.id,
      'transfer_initiated', 'debit', v_st.amount_paise, 'INR',
      'Razorpay Route transfer initiated to seller Linked Account',
      v_st.provider_transfer_id, p_actor_id
    )
    on conflict (transfer_id, entry_type)
    where transfer_id is not null and entry_type in ('transfer_initiated', 'transfer_settled')
    do nothing;

    update public.seller_transfers
    set status = 'processed',
        on_hold = false,
        settlement_status = 'settled',
        settlement_id = coalesce(nullif(trim(p_settlement_id), ''), settlement_id),
        provider_settlement_utr = coalesce(nullif(trim(p_settlement_utr), ''), provider_settlement_utr),
        settled_at = coalesce(settled_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        last_reconciled_at = now(),
        updated_at = now()
    where id = v_st.id
    returning * into v_st;

    if p_settlement_id is not null then
      insert into public.settlement_records (
        seller_id, seller_transfer_id, provider_settlement_id, utr, amount_paise, currency, status, settled_at, metadata
      ) values (
        v_st.seller_id, v_st.id, p_settlement_id, p_settlement_utr, v_st.amount_paise, 'INR', 'settled', now(), p_metadata
      )
      on conflict (provider_settlement_id) do update set
        utr = coalesce(excluded.utr, public.settlement_records.utr),
        status = 'settled',
        settled_at = coalesce(public.settlement_records.settled_at, now()),
        updated_at = now();
    end if;

    insert into public.financial_ledger_entries (
      order_id, seller_order_id, seller_id, payment_id, transfer_id,
      entry_type, direction, amount_paise, currency, description, reference_id, created_by
    ) values (
      v_st.order_id, v_st.seller_order_id, v_st.seller_id, v_st.payment_id, v_st.id,
      'transfer_settled', 'debit', greatest(0::bigint, v_st.amount_paise - v_st.reversed_paise), 'INR',
      'Razorpay Route transfer settled to seller bank account',
      coalesce(p_settlement_id, v_st.provider_transfer_id), p_actor_id
    )
    on conflict (transfer_id, entry_type)
    where transfer_id is not null and entry_type in ('transfer_initiated', 'transfer_settled')
    do nothing;

    if found then
      update public.seller_orders
      set settled_paise = settled_paise + greatest(0::bigint, v_st.amount_paise - v_st.reversed_paise),
          outstanding_balance_paise = greatest(
            0::bigint,
            seller_payable_paise - settled_paise - greatest(0::bigint, v_st.amount_paise - v_st.reversed_paise) + reversal_paise
          )
      where id = v_so.id;
    end if;

    return query select v_st.id, v_st.seller_order_id, v_st.status, v_st.settlement_status, false;
    return;
  end if;

  raise exception 'Unsupported transfer finalization status: %', v_target;
end;
$$;

revoke all on function public.finalize_seller_route_transfer(uuid, text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_seller_route_transfer(uuid, text, text, text, text, text, text, uuid, jsonb) to service_role;

-- ============================================================================
-- 5. ROUTE TRANSFER REVERSAL RESERVATION & FINALIZATION (REFUND INTEGRATED)
-- ============================================================================

create or replace function public.reserve_seller_transfer_reversal(
  p_actor_id uuid,
  p_transfer_id uuid,
  p_amount_paise bigint default null,
  p_refund_id uuid default null,
  p_reason text default 'Refund reversal adjustment',
  p_idempotency_key text default null
)
returns table (
  reversal_id uuid,
  seller_transfer_id uuid,
  provider_transfer_id text,
  seller_order_id uuid,
  order_id uuid,
  amount_paise bigint,
  already_initiated boolean,
  provider_reversal_id text,
  reversal_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.payment_gateway_config%rowtype;
  v_st public.seller_transfers%rowtype;
  v_existing public.seller_transfer_reversals%rowtype;
  v_pending_rev bigint := 0;
  v_reversible bigint := 0;
  v_target_amount bigint := 0;
  v_idem text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_new_id uuid;
begin
  if not public.is_operations_admin(p_actor_id) then
    raise exception 'Forbidden: only operations or super administrators may reverse Route transfers.';
  end if;
  if v_idem is null then
    raise exception 'idempotency_key is required.';
  end if;

  select * into v_cfg from public.payment_gateway_config where id = 1;
  if not found or v_cfg.razorpay_route_enabled = false or v_cfg.route_approval_status <> 'approved' then
    raise exception 'Razorpay Route is disabled or not yet approved.';
  end if;

  select * into v_existing
  from public.seller_transfer_reversals
  where idempotency_key = v_idem
  for update;

  if found then
    select * into v_st from public.seller_transfers where id = v_existing.seller_transfer_id;
    return query select
      v_existing.id, v_existing.seller_transfer_id, v_st.provider_transfer_id,
      v_existing.seller_order_id, v_existing.order_id, v_existing.amount_paise,
      true, v_existing.provider_reversal_id, v_existing.status;
    return;
  end if;

  select * into v_st
  from public.seller_transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'Seller transfer not found.';
  end if;

  if v_st.status not in ('created', 'processed', 'on_hold', 'partially_reversed')
     or nullif(trim(coalesce(v_st.provider_transfer_id, '')), '') is null then
    raise exception 'Transfer is not in a reversible Razorpay state.';
  end if;

  select coalesce(sum(r.amount_paise), 0)::bigint
  into v_pending_rev
  from public.seller_transfer_reversals r
  where r.seller_transfer_id = v_st.id
    and r.status = 'pending';

  v_reversible := greatest(0::bigint, v_st.amount_paise - v_st.reversed_paise - v_pending_rev);
  v_target_amount := coalesce(p_amount_paise, v_reversible);

  if v_target_amount <= 0 or v_target_amount > v_reversible then
    raise exception 'Requested reversal exceeds eligible remaining transfer balance.';
  end if;

  insert into public.seller_transfer_reversals (
    seller_transfer_id, seller_order_id, order_id, refund_id, seller_id,
    idempotency_key, amount_paise, currency, status, reason, initiated_by
  ) values (
    v_st.id, v_st.seller_order_id, v_st.order_id, p_refund_id, v_st.seller_id,
    v_idem, v_target_amount, 'INR', 'pending', coalesce(nullif(trim(p_reason), ''), 'Refund reversal adjustment'), p_actor_id
  )
  returning id into v_new_id;

  return query select
    v_new_id, v_st.id, v_st.provider_transfer_id, v_st.seller_order_id, v_st.order_id,
    v_target_amount, false, null::text, 'pending';
end;
$$;

revoke all on function public.reserve_seller_transfer_reversal(uuid, uuid, bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_seller_transfer_reversal(uuid, uuid, bigint, uuid, text, text) to service_role;

create or replace function public.finalize_seller_transfer_reversal(
  p_reversal_id uuid default null,
  p_provider_reversal_id text default null,
  p_provider_transfer_id text default null,
  p_next_status text default 'processed',
  p_amount_paise bigint default null,
  p_failure_reason text default null,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  reversal_id uuid,
  seller_transfer_id uuid,
  reversal_status text,
  transfer_status text,
  already_processed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rev public.seller_transfer_reversals%rowtype;
  v_st public.seller_transfers%rowtype;
  v_so public.seller_orders%rowtype;
  v_target text := lower(trim(coalesce(p_next_status, 'processed')));
  v_new_reversed bigint;
begin
  if p_reversal_id is not null then
    select * into v_rev from public.seller_transfer_reversals where id = p_reversal_id for update;
  elsif p_provider_reversal_id is not null then
    select * into v_rev from public.seller_transfer_reversals where provider_reversal_id = p_provider_reversal_id for update;
  end if;

  -- If reversal came purely from Razorpay dashboard webhook, match transfer and insert reversal row
  if not found and p_provider_transfer_id is not null and p_provider_reversal_id is not null then
    select * into v_st from public.seller_transfers where provider_transfer_id = p_provider_transfer_id for update;
    if found then
      insert into public.seller_transfer_reversals (
        seller_transfer_id, seller_order_id, order_id, seller_id,
        provider_reversal_id, idempotency_key, amount_paise, currency, status, reason, metadata
      ) values (
        v_st.id, v_st.seller_order_id, v_st.order_id, v_st.seller_id,
        p_provider_reversal_id, 'wh-rev:' || p_provider_reversal_id,
        greatest(1::bigint, coalesce(p_amount_paise, v_st.amount_paise - v_st.reversed_paise)),
        'INR', 'pending', 'Gateway webhook transfer reversal', p_metadata
      )
      on conflict (provider_reversal_id) do nothing
      returning * into v_rev;

      if v_rev.id is null then
        select * into v_rev from public.seller_transfer_reversals where provider_reversal_id = p_provider_reversal_id for update;
      end if;
    end if;
  end if;

  if v_rev.id is null then
    raise exception 'Transfer reversal record not found.';
  end if;

  select * into v_st from public.seller_transfers where id = v_rev.seller_transfer_id for update;

  if v_rev.status = 'processed' then
    return query select v_rev.id, v_rev.seller_transfer_id, v_rev.status, v_st.status, true;
    return;
  end if;

  if v_target = 'failed' then
    update public.seller_transfer_reversals
    set status = 'failed',
        provider_reversal_id = coalesce(nullif(trim(p_provider_reversal_id), ''), provider_reversal_id),
        failure_reason = p_failure_reason,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = v_rev.id
    returning * into v_rev;
    return query select v_rev.id, v_rev.seller_transfer_id, v_rev.status, v_st.status, false;
    return;
  end if;

  if v_target = 'processed' then
    select * into v_so from public.seller_orders where id = v_st.seller_order_id for update;

    update public.seller_transfer_reversals
    set status = 'processed',
        provider_reversal_id = coalesce(nullif(trim(p_provider_reversal_id), ''), provider_reversal_id),
        processed_at = coalesce(processed_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = v_rev.id
    returning * into v_rev;

    v_new_reversed := least(v_st.amount_paise, v_st.reversed_paise + v_rev.amount_paise);
    update public.seller_transfers
    set reversed_paise = v_new_reversed,
        status = case when v_new_reversed >= v_st.amount_paise then 'reversed' else 'partially_reversed' end,
        settlement_status = case when v_new_reversed >= v_st.amount_paise then 'reversed' else v_st.settlement_status end,
        last_reconciled_at = now(),
        updated_at = now()
    where id = v_st.id
    returning * into v_st;

    update public.seller_orders
    set reversal_paise = reversal_paise + v_rev.amount_paise
    where id = v_so.id;

    insert into public.financial_ledger_entries (
      order_id, seller_order_id, seller_id, payment_id, refund_id, transfer_id,
      entry_type, direction, amount_paise, currency, description, reference_id, created_by
    ) values (
      v_st.order_id, v_st.seller_order_id, v_st.seller_id, v_st.payment_id, v_rev.refund_id, v_st.id,
      'transfer_reversal', 'credit', v_rev.amount_paise, 'INR',
      'Razorpay Route transfer reversed from Linked Account',
      coalesce(v_rev.provider_reversal_id, v_rev.id::text), p_actor_id
    )
    on conflict (transfer_id, entry_type, reference_id)
    where transfer_id is not null and entry_type = 'transfer_reversal' and reference_id is not null
    do nothing;

    if v_rev.refund_id is not null then
      update public.refund_records
      set reversal_status = 'reversed',
          updated_at = now()
      where id = v_rev.refund_id;
    end if;

    return query select v_rev.id, v_rev.seller_transfer_id, v_rev.status, v_st.status, false;
    return;
  end if;

  return query select v_rev.id, v_rev.seller_transfer_id, v_rev.status, v_st.status, false;
end;
$$;

revoke all on function public.finalize_seller_transfer_reversal(uuid, text, text, text, bigint, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_seller_transfer_reversal(uuid, text, text, text, bigint, text, uuid, jsonb) to service_role;

-- ============================================================================
-- 6. SELLER & ADMIN SETTLEMENT OVERVIEW QUERIES (STRICT RBAC)
-- ============================================================================

create or replace function public.get_seller_settlement_summary(
  p_seller_id uuid default null
)
returns table (
  seller_id uuid,
  gross_sales_paise bigint,
  commission_paise bigint,
  refund_deductions_paise bigint,
  seller_payable_paise bigint,
  pending_transfers_paise bigint,
  settled_paise bigint,
  failed_transfers_paise bigint,
  reversed_transfers_paise bigint,
  cod_collected_paise bigint,
  cod_remitted_paise bigint,
  cod_outstanding_paise bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_seller_id uuid := p_seller_id;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if v_target_seller_id is null then
    select id into v_target_seller_id
    from public.seller_profiles
    where user_id = v_uid
    limit 1;
  end if;

  if v_target_seller_id is null then
    raise exception 'Seller profile not found.';
  end if;

  if not public.is_operations_admin(v_uid) then
    if not exists (
      select 1 from public.seller_profiles sp
      where sp.id = v_target_seller_id and sp.user_id = v_uid
    ) then
      raise exception 'Forbidden: cannot read settlement summary for another seller.';
    end if;
  end if;

  return query
  with so_agg as (
    select
      coalesce(sum(so.subtotal_paise), 0)::bigint as gross_sales,
      coalesce(sum(so.commission_amount_paise), 0)::bigint as commission_total,
      coalesce(sum(so.seller_payable_paise), 0)::bigint as raw_payable
    from public.seller_orders so
    join public.orders o on o.id = so.order_id
    where so.seller_id = v_target_seller_id
      and o.payment_method = 'online'
      and o.payment_status in ('captured', 'paid', 'partially_refunded', 'refunded')
  ),
  rf_agg as (
    select
      coalesce(sum(rsa.seller_payable_reversed_paise), 0)::bigint as refund_reversed
    from public.refund_seller_adjustments rsa
    join public.refund_records rr on rr.id = rsa.refund_id
    join public.orders o on o.id = rr.order_id
    where rsa.seller_id = v_target_seller_id
      and o.payment_method = 'online'
      and rr.status <> 'failed'
      and coalesce(rr.request_status, 'completed') <> 'rejected'
  ),
  tr_agg as (
    select
      coalesce(sum(case when st.status in ('pending', 'created', 'on_hold') or (st.status = 'processed' and st.settlement_status <> 'settled') then greatest(0::bigint, st.amount_paise - st.reversed_paise) else 0 end), 0)::bigint as pending_tr,
      coalesce(sum(case when st.settlement_status = 'settled' then greatest(0::bigint, st.amount_paise - st.reversed_paise) else 0 end), 0)::bigint as settled_tr,
      coalesce(sum(case when st.status = 'failed' then st.amount_paise else 0 end), 0)::bigint as failed_tr,
      coalesce(sum(st.reversed_paise), 0)::bigint as reversed_tr
    from public.seller_transfers st
    where st.seller_id = v_target_seller_id
  ),
  cod_agg as (
    select
      coalesce(sum(ccr.collected_amount_paise), 0)::bigint as cod_collected,
      coalesce(sum(case when ccr.reconciliation_status = 'remitted' then greatest(0::bigint, ccr.seller_payable_paise - ccr.courier_deduction_paise - ccr.refunded_amount_paise) else 0 end), 0)::bigint as cod_remitted,
      coalesce(sum(case when ccr.reconciliation_status in ('awaiting_collection', 'collected') then ccr.outstanding_amount_paise else 0 end), 0)::bigint as cod_outstanding
    from public.cod_collection_records ccr
    where ccr.seller_id = v_target_seller_id
  )
  select
    v_target_seller_id,
    so_agg.gross_sales,
    so_agg.commission_total,
    rf_agg.refund_reversed,
    greatest(0::bigint, so_agg.raw_payable - rf_agg.refund_reversed),
    tr_agg.pending_tr,
    tr_agg.settled_tr,
    tr_agg.failed_tr,
    tr_agg.reversed_tr,
    cod_agg.cod_collected,
    cod_agg.cod_remitted,
    cod_agg.cod_outstanding
  from so_agg, rf_agg, tr_agg, cod_agg;
end;
$$;

revoke all on function public.get_seller_settlement_summary(uuid) from public, anon;
grant execute on function public.get_seller_settlement_summary(uuid) to authenticated;

commit;
