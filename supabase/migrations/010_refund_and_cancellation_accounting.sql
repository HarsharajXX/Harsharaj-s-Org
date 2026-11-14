-- NOHAJ Marketplace — Stage 7.8.3: Refund Management, Cancellation Accounting & Financial Reconciliation
-- Migration: 010_refund_and_cancellation_accounting.sql
-- Depends on: 001_initial_schema.sql through 009_razorpay_checkout_verification.sql.
-- Safe to rerun: Yes (forward-only, transaction-wrapped, precondition-checked, idempotent).
--
-- Scope:
--   - Extends append-only financial_ledger_entries with refund, commission reversal,
--     seller payable reversal, COD refund, and courier adjustment entry types + uniqueness guards.
--   - Adds partial/full/multi-vendor refund workflow tables (refund_items,
--     refund_seller_adjustments, refund_internal_notes) with strict role isolation
--     (customers never see internal admin notes or seller payable/commission reversals;
--      sellers see only their own seller_order adjustments; content_admin has zero access).
--   - Enforces overlapping refund limits, historical 12% commission snapshot reversals
--     in integer paise, out-of-order Razorpay refund webhook state machine,
--     COD cancellation accounting across pre-collection / post-dispatch / RTO / manual refund,
--     and explicit inspection-gated restocking separation.

begin;

-- ============================================================================
-- 0. PRECONDITION CHECKS (VERIFY 001–009 ARE APPLIED)
-- ============================================================================

do $$
begin
  if to_regclass('public.refund_records') is null
     or to_regclass('public.cod_collection_records') is null
     or to_regclass('public.financial_ledger_entries') is null
     or to_regclass('public.returns') is null
     or to_regprocedure('public.finalize_online_payment_capture(uuid, text, text, bigint, text, boolean, boolean, text, bigint, text)') is null
     or to_regprocedure('public.recompute_parent_order_status(uuid)') is null
     or to_regprocedure('public.internal_restore_seller_order_inventory(uuid)') is null
     or to_regprocedure('public.is_operations_admin(uuid)') is null then
    raise exception 'Precondition failed: migrations 001 through 009 must be applied before 010_refund_and_cancellation_accounting.sql.';
  end if;
end $$;

-- ============================================================================
-- 1. EXTEND LEDGER ENTRY TYPES, ORDER ITEMS, RETURNS, COD & REFUND TABLES
-- ============================================================================

alter table public.financial_ledger_entries
  drop constraint if exists financial_ledger_entries_entry_type_check;

alter table public.financial_ledger_entries
  add constraint financial_ledger_entries_entry_type_check
  check (entry_type in (
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
    'manual_adjustment',
    'commission_reversal',
    'seller_payable_reversal',
    'gateway_refund',
    'cod_refund',
    'courier_adjustment'
  ));

create unique index if not exists idx_ledger_unique_refund_order_type
  on public.financial_ledger_entries(refund_id, entry_type)
  where refund_id is not null and seller_order_id is null;

create unique index if not exists idx_ledger_unique_refund_seller_type
  on public.financial_ledger_entries(refund_id, seller_order_id, entry_type)
  where refund_id is not null and seller_order_id is not null;

-- Allow operations_admin to write audit entries for Stage 7.8.3 financial/refund tables
drop policy if exists "Admins insert audit logs" on public.audit_logs;
create policy "Admins insert audit logs"
  on public.audit_logs for insert
  with check (
    actor_id = auth.uid()
    and (
      public.is_super_admin(auth.uid())
      or (
        public.is_operations_admin(auth.uid())
        and target_table in (
          'seller_profiles', 'orders', 'seller_orders', 'payments',
          'shipments', 'returns', 'seller_applications',
          'refund_records', 'refund_items', 'cod_collection_records', 'financial_ledger_entries'
        )
      )
      or (
        public.is_content_admin(auth.uid())
        and target_table in (
          'products', 'product_images', 'product_variants',
          'communities', 'categories', 'reviews'
        )
      )
    )
  );

-- Extend order_items to track cumulative refunded and inspected-restocked quantities
alter table public.order_items
  add column if not exists refunded_quantity integer not null default 0,
  add column if not exists refunded_paise bigint not null default 0,
  add column if not exists restocked_quantity integer not null default 0;

alter table public.order_items drop constraint if exists order_items_refunded_quantity_check;
alter table public.order_items
  add constraint order_items_refunded_quantity_check
  check (refunded_quantity >= 0 and refunded_quantity <= quantity);

alter table public.order_items drop constraint if exists order_items_restocked_quantity_check;
alter table public.order_items
  add constraint order_items_restocked_quantity_check
  check (restocked_quantity >= 0 and restocked_quantity <= quantity);

-- Extend returns table for explicit physical inspection & restocking separation
alter table public.returns
  add column if not exists restock_status text not null default 'pending_inspection',
  add column if not exists inspection_notes text,
  add column if not exists inspected_by uuid references public.profiles(id),
  add column if not exists inspected_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.returns drop constraint if exists returns_restock_status_check;
alter table public.returns
  add constraint returns_restock_status_check
  check (restock_status in ('pending_inspection', 'restocked', 'rejected_damaged', 'not_applicable'));

-- Sellers can inspect/view return requests for their own seller_orders (never content_admin)
drop policy if exists "Customers view and request returns" on public.returns;
create policy "Customers sellers ops admins view returns"
  on public.returns for select
  using (
    auth.uid() = customer_id
    or exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- Extend cod_collection_records for explicit COD cancellation & manual refund accounting
alter table public.cod_collection_records
  add column if not exists refunded_amount_paise bigint not null default 0 check (refunded_amount_paise >= 0),
  add column if not exists cod_cancellation_stage text,
  add column if not exists courier_deduction_paise bigint not null default 0 check (courier_deduction_paise >= 0),
  add column if not exists manual_refund_reference text,
  add column if not exists manual_refund_method text,
  add column if not exists manual_refund_date timestamptz;

alter table public.cod_collection_records drop constraint if exists cod_collection_records_cancellation_stage_check;
alter table public.cod_collection_records
  add constraint cod_collection_records_cancellation_stage_check
  check (
    cod_cancellation_stage is null
    or cod_cancellation_stage in (
      'before_collection',
      'after_dispatch',
      'failed_delivery_rto',
      'manual_refund_after_collection'
    )
  );

-- Extend refund_records for customer request workflow, manual COD reference & restock separation
alter table public.refund_records
  add column if not exists request_status text not null default 'approved',
  add column if not exists requested_by uuid references public.profiles(id),
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles(id),
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists refund_type text not null default 'full',
  add column if not exists refund_method text,
  add column if not exists manual_reference text,
  add column if not exists manual_refund_date timestamptz,
  add column if not exists courier_deduction_paise bigint not null default 0 check (courier_deduction_paise >= 0),
  add column if not exists restock_required boolean not null default false,
  add column if not exists restock_status text not null default 'not_applicable',
  add column if not exists restocked_at timestamptz,
  add column if not exists restocked_by uuid references public.profiles(id);

alter table public.refund_records drop constraint if exists refund_records_request_status_check;
alter table public.refund_records
  add constraint refund_records_request_status_check
  check (request_status in ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed'));

alter table public.refund_records drop constraint if exists refund_records_refund_type_check;
alter table public.refund_records
  add constraint refund_records_refund_type_check
  check (refund_type in ('full', 'partial_item', 'partial_seller_order', 'cancellation', 'cod_manual'));

alter table public.refund_records drop constraint if exists refund_records_restock_status_check;
alter table public.refund_records
  add constraint refund_records_restock_status_check
  check (restock_status in ('not_applicable', 'pending_inspection', 'restocked', 'rejected_damaged'));

-- Strictly isolated internal admin notes (never readable by customers, sellers, or content_admin)
create table if not exists public.refund_internal_notes (
  id uuid primary key default uuid_generate_v4(),
  refund_id uuid not null unique references public.refund_records(id) on delete cascade,
  internal_notes text not null default '',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.refund_internal_notes enable row level security;
drop policy if exists "Ops and super admins manage refund internal notes" on public.refund_internal_notes;
create policy "Ops and super admins manage refund internal notes"
  on public.refund_internal_notes for all
  using (public.is_operations_admin(auth.uid()))
  with check (public.is_operations_admin(auth.uid()));

revoke all on public.refund_internal_notes from public, anon, authenticated;
grant select, insert, update on public.refund_internal_notes to authenticated;
grant all on public.refund_internal_notes to service_role;

-- Item-level refund breakdown & inspection-based restocking tracking
create table if not exists public.refund_items (
  id uuid primary key default uuid_generate_v4(),
  refund_id uuid not null references public.refund_records(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_order_id uuid not null references public.seller_orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  refund_amount_paise bigint not null check (refund_amount_paise > 0),
  restock_eligible boolean not null default false,
  restocked_quantity integer not null default 0 check (restocked_quantity >= 0 and restocked_quantity <= quantity),
  restocked_at timestamptz,
  restocked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(refund_id, order_item_id)
);
create index if not exists idx_refund_items_refund_id on public.refund_items(refund_id);
create index if not exists idx_refund_items_seller_order_id on public.refund_items(seller_order_id);

alter table public.refund_items enable row level security;
drop policy if exists "Order parties and ops admins read refund items" on public.refund_items;
create policy "Order parties and ops admins read refund items"
  on public.refund_items for select
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

revoke all on public.refund_items from public, anon, authenticated;
grant select on public.refund_items to authenticated;
grant all on public.refund_items to service_role;

-- Seller-level proportional refund accounting (isolated from customers & content_admin)
create table if not exists public.refund_seller_adjustments (
  id uuid primary key default uuid_generate_v4(),
  refund_id uuid not null references public.refund_records(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_order_id uuid not null references public.seller_orders(id) on delete cascade,
  seller_id uuid not null references public.seller_profiles(id),
  gross_refund_paise bigint not null check (gross_refund_paise > 0),
  commission_rate_bps integer not null check (commission_rate_bps >= 0 and commission_rate_bps <= 5000),
  commission_reversed_paise bigint not null default 0 check (commission_reversed_paise >= 0),
  seller_payable_reversed_paise bigint not null default 0 check (seller_payable_reversed_paise >= 0),
  courier_deduction_paise bigint not null default 0 check (courier_deduction_paise >= 0),
  applied_to_balances boolean not null default false,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique(refund_id, seller_order_id)
);
create index if not exists idx_refund_seller_adj_seller_id on public.refund_seller_adjustments(seller_id);
create index if not exists idx_refund_seller_adj_refund_id on public.refund_seller_adjustments(refund_id);

alter table public.refund_seller_adjustments enable row level security;
drop policy if exists "Sellers and ops admins read refund seller adjustments" on public.refund_seller_adjustments;
create policy "Sellers and ops admins read refund seller adjustments"
  on public.refund_seller_adjustments for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

revoke all on public.refund_seller_adjustments from public, anon, authenticated;
grant select on public.refund_seller_adjustments to authenticated;
grant all on public.refund_seller_adjustments to service_role;

-- ============================================================================
-- 2. NOTIFICATION & PROPORTIONAL COMMISSION HELPERS
-- ============================================================================

create or replace function public.internal_emit_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, type, title, message)
  values (p_user_id, p_type, p_title, p_message);
end;
$$;

revoke all on function public.internal_emit_notification(uuid, text, text, text) from public, anon, authenticated;

-- Computes exact proportional commission & seller payable reversal from historical seller_orders snapshot.
-- Never queries current marketplace_settings. Clamps cumulative reversal to remaining historical snapshot
-- so repeated partial refunds sum accurately without paise rounding drift.
create or replace function public.internal_calculate_proportional_reversal(
  p_seller_order_id uuid,
  p_gross_refund_paise bigint
)
returns table (
  commission_rate_bps integer,
  commission_reversed_paise bigint,
  seller_payable_reversed_paise bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.seller_orders%rowtype;
  v_rate_bps integer;
  v_already_refunded bigint := 0;
  v_already_comm_reversed bigint := 0;
  v_already_payable_reversed bigint := 0;
  v_remaining_subtotal bigint;
  v_remaining_comm bigint;
  v_remaining_payable bigint;
  v_comm_rev bigint;
  v_payable_rev bigint;
begin
  select * into v_so
  from public.seller_orders
  where id = p_seller_order_id
  for update;

  if not found then
    raise exception 'Seller order % not found for proportional reversal.', p_seller_order_id;
  end if;

  v_rate_bps := greatest(
    0,
    least(5000, round(coalesce(v_so.commission_rate_snapshot, 0.1200) * 10000)::integer)
  );

  select
    coalesce(sum(rsa.gross_refund_paise), 0),
    coalesce(sum(rsa.commission_reversed_paise), 0),
    coalesce(sum(rsa.seller_payable_reversed_paise), 0)
  into v_already_refunded, v_already_comm_reversed, v_already_payable_reversed
  from public.refund_seller_adjustments rsa
  where rsa.seller_order_id = p_seller_order_id
    and rsa.applied_to_balances = true;

  v_remaining_subtotal := greatest(0, v_so.subtotal_paise - v_already_refunded);
  v_remaining_comm := greatest(0, v_so.commission_amount_paise - v_already_comm_reversed);
  v_remaining_payable := greatest(0, v_so.seller_payable_paise - v_already_payable_reversed);

  if p_gross_refund_paise <= 0 or v_so.subtotal_paise <= 0 then
    return query select v_rate_bps, 0::bigint, 0::bigint;
    return;
  end if;

  -- If this refund exhausts the remaining seller product subtotal, reverse exact remaining amounts.
  if p_gross_refund_paise >= v_remaining_subtotal and v_remaining_subtotal > 0 then
    v_comm_rev := v_remaining_comm;
    v_payable_rev := greatest(0, least(p_gross_refund_paise - v_comm_rev, v_remaining_payable));
  else
    v_comm_rev := least(
      v_remaining_comm,
      round((v_so.commission_amount_paise::numeric * p_gross_refund_paise::numeric) / v_so.subtotal_paise::numeric)::bigint
    );
    v_payable_rev := greatest(0, least(p_gross_refund_paise - v_comm_rev, v_remaining_payable));
  end if;

  return query select v_rate_bps, v_comm_rev, v_payable_rev;
end;
$$;

revoke all on function public.internal_calculate_proportional_reversal(uuid, bigint) from public, anon, authenticated;

-- Extend recompute_parent_order_status to reflect online & COD refund states accurately
create or replace function public.recompute_parent_order_status(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_so integer;
  v_cancelled_so integer;
  v_delivered_so integer;
  v_dispatched_so integer;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_has_pending_refund boolean := false;
  v_total_cod_collected bigint := 0;
  v_total_cod_refunded bigint := 0;
  v_next_status text;
  v_next_payment_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return; end if;

  select
    count(*),
    count(*) filter (where fulfilment_status = 'cancelled'),
    count(*) filter (where fulfilment_status = 'delivered'),
    count(*) filter (where fulfilment_status in ('shipped', 'dispatched', 'delivered'))
  into v_total_so, v_cancelled_so, v_delivered_so, v_dispatched_so
  from public.seller_orders
  where order_id = p_order_id;

  if v_total_so = 0 then return; end if;

  if v_cancelled_so = v_total_so then
    v_next_status := 'cancelled';
  elsif v_cancelled_so > 0 then
    v_next_status := 'partially_cancelled';
  elsif v_delivered_so = v_total_so then
    v_next_status := 'delivered';
  elsif v_dispatched_so = v_total_so then
    v_next_status := 'dispatched';
  elsif v_dispatched_so > 0 then
    v_next_status := 'partially_dispatched';
  else
    v_next_status := v_order.order_status;
  end if;

  v_next_payment_status := v_order.payment_status;

  if v_order.payment_method = 'online' then
    select * into v_payment
    from public.payments p
    where p.order_id = p_order_id and p.provider = 'razorpay'
    limit 1;

    select exists (
      select 1 from public.refund_records rr
      where rr.order_id = p_order_id
        and rr.status = 'pending'
        and rr.request_status in ('approved', 'processing')
    ) into v_has_pending_refund;

    if found and coalesce(v_payment.captured_paise, 0) > 0 then
      if coalesce(v_payment.refunded_paise, 0) >= v_payment.captured_paise then
        v_next_payment_status := 'refunded';
      elsif coalesce(v_payment.refunded_paise, 0) > 0 then
        v_next_payment_status := 'partially_refunded';
      elsif v_has_pending_refund then
        v_next_payment_status := 'refund_pending';
      elsif v_order.payment_status = 'refund_pending' then
        v_next_payment_status := 'paid';
      end if;
    end if;
  else
    select
      coalesce(sum(collected_amount_paise), 0),
      coalesce(sum(refunded_amount_paise), 0)
    into v_total_cod_collected, v_total_cod_refunded
    from public.cod_collection_records
    where order_id = p_order_id;

    if v_total_cod_collected > 0 and v_total_cod_refunded >= v_total_cod_collected then
      v_next_payment_status := 'refunded';
    elsif v_total_cod_refunded > 0 then
      v_next_payment_status := 'partially_refunded';
    elsif v_cancelled_so = v_total_so and v_order.payment_status = 'cod_pending' then
      v_next_payment_status := 'cancelled';
    end if;
  end if;

  update public.orders
  set
    order_status = v_next_status,
    payment_status = v_next_payment_status,
    cancelled_at = case when v_next_status = 'cancelled' and cancelled_at is null then now() else cancelled_at end,
    updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.recompute_parent_order_status(uuid) from public, anon, authenticated;

-- ============================================================================
-- 3. CUSTOMER & ADMIN REFUND REQUEST WORKFLOW + PRIVACY-SAFE READERS
-- ============================================================================

-- Customer or operations admin submits a refund / post-fulfilment cancellation request.
-- Validates ownership, order eligibility, item quantities, and cumulative refundable balance.
create or replace function public.request_order_refund(
  p_order_id uuid,
  p_seller_order_id uuid default null,
  p_items jsonb default null, -- array of { order_item_id, quantity }
  p_amount_paise bigint default null,
  p_reason text default 'Refund requested',
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_ops_admin boolean := public.is_operations_admin(v_uid);
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_refund_id uuid;
  v_channel text;
  v_refund_type text := 'full';
  v_clean_reason text := coalesce(nullif(trim(p_reason), ''), 'Refund requested');
  v_idem_key text;
  v_existing_id uuid;
  v_refundable_cap_paise bigint := 0;
  v_already_reserved_paise bigint := 0;
  v_requested_amount_paise bigint := 0;
  v_item jsonb;
  v_oi public.order_items%rowtype;
  v_so public.seller_orders%rowtype;
  v_req_qty integer;
  v_already_item_qty integer;
  v_line_paise bigint;
  v_target_so_id uuid := p_seller_order_id;
  v_needs_inspection boolean := false;
  v_seller_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.customer_id <> v_uid and not v_is_ops_admin then
    raise exception 'You are not authorized to request a refund for this order.';
  end if;

  v_idem_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'req:' || p_order_id::text || ':' || coalesce(p_seller_order_id::text, 'all') || ':' || md5(coalesce(p_items::text, '') || ':' || coalesce(p_amount_paise::text, '') || ':' || v_clean_reason)
  );

  select id into v_existing_id
  from public.refund_records
  where idempotency_key = v_idem_key;

  if found then
    return v_existing_id;
  end if;

  if v_order.payment_method = 'online' then
    select * into v_payment
    from public.payments p
    where p.order_id = v_order.id and p.provider = 'razorpay'
    for update;

    if not found or coalesce(v_payment.captured_paise, 0) <= 0 or v_payment.provider_payment_id is null then
      raise exception 'Online payment has not been captured; unpaid or failed checkouts cannot be refunded.';
    end if;

    v_channel := 'razorpay';
    v_refundable_cap_paise := v_payment.captured_paise;
  else
    v_channel := 'cod_manual';
    select coalesce(sum(collected_amount_paise), 0)
    into v_refundable_cap_paise
    from public.cod_collection_records
    where order_id = v_order.id;

    if v_refundable_cap_paise <= 0 then
      raise exception 'Cash has not been collected for this COD order; cancel the order instead of issuing a cash refund.';
    end if;
  end if;

  -- Sum all active (pending/requested/approved/processing) and completed refunds to prevent overlap
  select coalesce(sum(rr.amount_paise), 0)
  into v_already_reserved_paise
  from public.refund_records rr
  where rr.order_id = v_order.id
    and rr.request_status <> 'rejected'
    and rr.status <> 'failed';

  if v_already_reserved_paise >= v_refundable_cap_paise then
    raise exception 'No refundable balance remains for this order.';
  end if;

  create temp table if not exists _req_refund_items (
    order_item_id uuid not null,
    seller_order_id uuid not null,
    product_id uuid not null,
    variant_id uuid,
    quantity integer not null,
    unit_price_paise bigint not null,
    refund_amount_paise bigint not null,
    restock_eligible boolean not null
  ) on commit drop;
  truncate table _req_refund_items;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    v_refund_type := 'partial_item';
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_req_qty := (v_item->>'quantity')::integer;
      if v_req_qty is null or v_req_qty <= 0 then
        raise exception 'Refund item quantity must be positive.';
      end if;

      select * into v_oi
      from public.order_items
      where id = (v_item->>'order_item_id')::uuid
        and order_id = v_order.id
      for update;

      if not found then
        raise exception 'Order item not found in this order.';
      end if;

      if p_seller_order_id is not null and v_oi.seller_order_id <> p_seller_order_id then
        raise exception 'Order item does not belong to the specified seller order.';
      end if;

      select * into v_so from public.seller_orders where id = v_oi.seller_order_id;

      select coalesce(sum(ri.quantity), 0)
      into v_already_item_qty
      from public.refund_items ri
      join public.refund_records rr on rr.id = ri.refund_id
      where ri.order_item_id = v_oi.id
        and rr.request_status <> 'rejected'
        and rr.status <> 'failed';

      if v_already_item_qty + v_req_qty > v_oi.quantity then
        raise exception 'Requested refund quantity exceeds remaining refundable units for %.', v_oi.product_name;
      end if;

      v_line_paise := coalesce(v_oi.unit_price_paise, round(v_oi.unit_price * 100)::bigint) * v_req_qty;
      v_requested_amount_paise := v_requested_amount_paise + v_line_paise;

      if v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered') then
        v_needs_inspection := true;
      end if;

      insert into _req_refund_items (
        order_item_id, seller_order_id, product_id, variant_id,
        quantity, unit_price_paise, refund_amount_paise, restock_eligible
      ) values (
        v_oi.id, v_oi.seller_order_id, v_oi.product_id, v_oi.variant_id,
        v_req_qty, coalesce(v_oi.unit_price_paise, round(v_oi.unit_price * 100)::bigint),
        v_line_paise, (v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered'))
      );
    end loop;

    if p_amount_paise is not null and p_amount_paise > 0 and p_amount_paise <= v_requested_amount_paise then
      v_requested_amount_paise := p_amount_paise;
    end if;
  elsif p_seller_order_id is not null then
    v_refund_type := 'partial_seller_order';
    select * into v_so
    from public.seller_orders
    where id = p_seller_order_id and order_id = v_order.id
    for update;

    if not found then
      raise exception 'Seller order not found in this order.';
    end if;

    v_requested_amount_paise := coalesce(p_amount_paise, v_so.subtotal_paise);
    if v_requested_amount_paise <= 0 or v_requested_amount_paise > v_so.subtotal_paise then
      raise exception 'Seller order refund amount exceeds seller order subtotal.';
    end if;

    if v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered') then
      v_needs_inspection := true;
    end if;
  else
    v_refund_type := case
      when coalesce(p_amount_paise, v_refundable_cap_paise - v_already_reserved_paise) < (v_refundable_cap_paise - v_already_reserved_paise)
      then 'partial_seller_order'
      else 'full'
    end;
    v_requested_amount_paise := coalesce(p_amount_paise, v_refundable_cap_paise - v_already_reserved_paise);

    select exists (
      select 1 from public.seller_orders
      where order_id = v_order.id
        and fulfilment_status in ('shipped', 'dispatched', 'delivered')
    ) into v_needs_inspection;
  end if;

  if v_requested_amount_paise <= 0 then
    raise exception 'Refund amount must be positive.';
  end if;

  if v_already_reserved_paise + v_requested_amount_paise > v_refundable_cap_paise then
    raise exception 'Requested refund (% paise) exceeds remaining refundable balance (% paise).',
      v_requested_amount_paise, (v_refundable_cap_paise - v_already_reserved_paise);
  end if;

  insert into public.refund_records (
    order_id, seller_order_id, payment_id, refund_channel, refund_type,
    idempotency_key, amount_paise, currency, status, request_status,
    reason, initiated_by, requested_by,
    restock_required, restock_status
  ) values (
    v_order.id, v_target_so_id, v_payment.id, v_channel, v_refund_type,
    v_idem_key, v_requested_amount_paise, 'INR', 'pending', 'requested',
    v_clean_reason, v_uid, v_uid,
    v_needs_inspection,
    case when v_needs_inspection then 'pending_inspection' else 'not_applicable' end
  )
  returning id into v_refund_id;

  insert into public.refund_items (
    refund_id, order_id, seller_order_id, order_item_id,
    product_id, variant_id, quantity, unit_price_paise, refund_amount_paise, restock_eligible
  )
  select
    v_refund_id, v_order.id, seller_order_id, order_item_id,
    product_id, variant_id, quantity, unit_price_paise, refund_amount_paise, restock_eligible
  from _req_refund_items;

  perform public.internal_emit_notification(
    v_order.customer_id,
    'order_status',
    'Refund Request Received',
    'Your refund request for order ' || v_order.order_number || ' has been received and is awaiting review.'
  );

  for v_seller_user_id in
    select distinct sp.user_id
    from public.seller_orders so
    join public.seller_profiles sp on sp.id = so.seller_id
    where so.order_id = v_order.id
      and (p_seller_order_id is null or so.id = p_seller_order_id)
  loop
    perform public.internal_emit_notification(
      v_seller_user_id,
      'order_status',
      'Customer Refund / Cancellation Request',
      'A refund request was submitted for order ' || v_order.order_number || '.'
    );
  end loop;

  insert into public.order_status_history (order_id, seller_order_id, status, note, changed_by)
  values (
    v_order.id,
    v_target_so_id,
    'refund_requested',
    v_clean_reason,
    v_uid
  );

  return v_refund_id;
end;
$$;

revoke all on function public.request_order_refund(uuid, uuid, jsonb, bigint, text, text) from public, anon;
grant execute on function public.request_order_refund(uuid, uuid, jsonb, bigint, text, text) to authenticated;

-- Operations/Super Admin reviews (approves or rejects) a customer refund request.
create or replace function public.review_refund_request(
  p_refund_id uuid,
  p_decision text, -- 'approved' | 'rejected'
  p_rejection_reason text default null,
  p_internal_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_refund public.refund_records%rowtype;
  v_order public.orders%rowtype;
begin
  if v_uid is null or not public.is_operations_admin(v_uid) then
    raise exception 'Only operations or super administrators can review refund requests.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid review decision %. Expected approved or rejected.', p_decision;
  end if;

  select * into v_refund from public.refund_records where id = p_refund_id for update;
  if not found then
    raise exception 'Refund record not found.';
  end if;

  select * into v_order from public.orders where id = v_refund.order_id;

  if v_refund.request_status not in ('requested', 'approved') then
    raise exception 'Refund request in status % cannot be reviewed.', v_refund.request_status;
  end if;

  if p_decision = 'rejected' then
    if nullif(trim(coalesce(p_rejection_reason, '')), '') is null then
      raise exception 'Rejection reason is required when rejecting a refund request.';
    end if;

    update public.refund_records
    set
      request_status = 'rejected',
      status = 'failed',
      rejected_by = v_uid,
      rejected_at = now(),
      rejection_reason = trim(p_rejection_reason),
      failure_reason = trim(p_rejection_reason),
      updated_at = now()
    where id = v_refund.id;

    perform public.internal_emit_notification(
      v_order.customer_id,
      'order_status',
      'Refund / Cancellation Request Rejected',
      'Your request for order ' || v_order.order_number || ' was not approved: ' || trim(p_rejection_reason)
    );
  else
    update public.refund_records
    set
      request_status = 'approved',
      approved_by = v_uid,
      approved_at = now(),
      updated_at = now()
    where id = v_refund.id;

    perform public.internal_emit_notification(
      v_order.customer_id,
      'order_status',
      'Cancellation / Refund Approved',
      'Your refund request for order ' || v_order.order_number || ' has been approved for processing.'
    );
  end if;

  if nullif(trim(coalesce(p_internal_notes, '')), '') is not null then
    insert into public.refund_internal_notes (refund_id, internal_notes, updated_by)
    values (v_refund.id, trim(p_internal_notes), v_uid)
    on conflict (refund_id) do update
    set
      internal_notes = excluded.internal_notes,
      updated_by = excluded.updated_by,
      updated_at = now();
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, details)
  values (
    v_uid,
    case when p_decision = 'approved' then 'APPROVE_REFUND_REQUEST' else 'REJECT_REFUND_REQUEST' end,
    'refund_records',
    v_refund.id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_id', v_refund.order_id,
      'decision', p_decision,
      'rejection_reason', p_rejection_reason
    ))
  );

  return jsonb_build_object(
    'refund_id', v_refund.id,
    'request_status', p_decision
  );
end;
$$;

revoke all on function public.review_refund_request(uuid, text, text, text) from public, anon;
grant execute on function public.review_refund_request(uuid, text, text, text) to authenticated;

-- Customer-safe refund summary reader: explicitly omits internal admin notes, commission reversals,
-- and seller payable reversals while showing refund status, amount, channel, and affected items.
create or replace function public.get_customer_refund_summaries(p_order_id uuid default null)
returns table (
  refund_id uuid,
  order_id uuid,
  seller_order_id uuid,
  refund_channel text,
  refund_type text,
  amount_paise bigint,
  shipping_refund_paise bigint,
  status text,
  request_status text,
  reason text,
  rejection_reason text,
  provider_refund_id text,
  manual_reference text,
  refund_method text,
  restock_status text,
  created_at timestamptz,
  processed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    rr.id as refund_id,
    rr.order_id,
    rr.seller_order_id,
    rr.refund_channel,
    rr.refund_type,
    rr.amount_paise,
    rr.shipping_refund_paise,
    rr.status,
    rr.request_status,
    rr.reason,
    rr.rejection_reason,
    rr.provider_refund_id,
    rr.manual_reference,
    rr.refund_method,
    rr.restock_status,
    rr.created_at,
    rr.processed_at
  from public.refund_records rr
  join public.orders o on o.id = rr.order_id
  where o.customer_id = auth.uid()
    and (p_order_id is null or rr.order_id = p_order_id)
  order by rr.created_at desc;
$$;

revoke all on function public.get_customer_refund_summaries(uuid) from public, anon;
grant execute on function public.get_customer_refund_summaries(uuid) to authenticated;

-- Seller-scoped refund summary reader: returns ONLY the authenticated seller's own seller_orders.
create or replace function public.get_seller_refund_summaries()
returns table (
  refund_id uuid,
  order_id uuid,
  order_number text,
  seller_order_id uuid,
  refund_channel text,
  refund_type text,
  gross_refund_paise bigint,
  commission_reversed_paise bigint,
  seller_payable_reversed_paise bigint,
  courier_deduction_paise bigint,
  status text,
  request_status text,
  reason text,
  restock_status text,
  created_at timestamptz,
  processed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    rr.id as refund_id,
    rr.order_id,
    o.order_number,
    rsa.seller_order_id,
    rr.refund_channel,
    rr.refund_type,
    rsa.gross_refund_paise,
    rsa.commission_reversed_paise,
    rsa.seller_payable_reversed_paise,
    rsa.courier_deduction_paise,
    rr.status,
    rr.request_status,
    rr.reason,
    rr.restock_status,
    rr.created_at,
    rr.processed_at
  from public.refund_seller_adjustments rsa
  join public.refund_records rr on rr.id = rsa.refund_id
  join public.orders o on o.id = rr.order_id
  join public.seller_profiles sp on sp.id = rsa.seller_id
  where sp.user_id = auth.uid()
  order by rr.created_at desc;
$$;

revoke all on function public.get_seller_refund_summaries() from public, anon;
grant execute on function public.get_seller_refund_summaries() to authenticated;

-- ============================================================================
-- 4. SERVER-ONLY ONLINE REFUND RESERVATION & WEBHOOK FINALIZATION RPCS
-- ============================================================================

-- Reserves an online Razorpay refund atomically before calling the Razorpay Refunds API.
-- Prevents uncaptured/COD/over-refund/duplicate idempotency key execution.
create or replace function public.reserve_online_refund(
  p_actor_id uuid,
  p_order_id uuid,
  p_refund_id uuid default null,
  p_seller_order_id uuid default null,
  p_items jsonb default null,
  p_amount_paise bigint default null,
  p_shipping_refund_paise bigint default 0,
  p_reason text default 'Admin initiated refund',
  p_idempotency_key text default null,
  p_internal_notes text default null
)
returns table (
  refund_id uuid,
  order_id uuid,
  provider_payment_id text,
  amount_paise bigint,
  currency text,
  already_initiated boolean,
  provider_refund_id text,
  refund_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_refund public.refund_records%rowtype;
  v_so public.seller_orders%rowtype;
  v_oi public.order_items%rowtype;
  v_idem_key text;
  v_reserved_or_processed bigint := 0;
  v_total_request_paise bigint := 0;
  v_product_refund_paise bigint := 0;
  v_shipping_paise bigint := greatest(0, coalesce(p_shipping_refund_paise, 0));
  v_item jsonb;
  v_qty integer;
  v_line_paise bigint;
  v_already_item_qty integer;
  v_refund_type text := 'full';
  v_needs_inspection boolean := false;
  v_adj_row record;
  v_rev record;
begin
  if p_actor_id is null or not public.is_operations_admin(p_actor_id) then
    raise exception 'Only authorized operations or super administrators may initiate online refunds.';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found.', p_order_id;
  end if;

  if v_order.payment_method <> 'online' then
    raise exception 'Razorpay refunds apply only to online payment orders; use manual COD refund accounting for COD orders.';
  end if;

  select * into v_payment
  from public.payments p
  where p.order_id = v_order.id and p.provider = 'razorpay'
  for update;

  if not found or coalesce(v_payment.captured_paise, 0) <= 0 or nullif(trim(coalesce(v_payment.provider_payment_id, '')), '') is null then
    raise exception 'Payment is not captured; uncaptured or unpaid orders cannot be refunded through Razorpay.';
  end if;

  v_idem_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'online-rfnd:' || p_order_id::text || ':' || coalesce(p_refund_id::text, coalesce(p_seller_order_id::text, 'full')) || ':' || coalesce(p_amount_paise::text, 'auto')
  );

  -- Check idempotency key first (exact-once initiation)
  select * into v_refund
  from public.refund_records
  where idempotency_key = v_idem_key
  for update;

  if found then
    return query select
      v_refund.id, v_refund.order_id, v_payment.provider_payment_id,
      v_refund.amount_paise, v_refund.currency, true,
      v_refund.provider_refund_id, v_refund.status;
    return;
  end if;

  -- Sum existing non-failed refunds to enforce strict captured_paise cap under concurrency
  select coalesce(sum(rr.amount_paise), 0)
  into v_reserved_or_processed
  from public.refund_records rr
  where rr.order_id = v_order.id
    and rr.id is distinct from p_refund_id
    and rr.request_status <> 'rejected'
    and rr.status <> 'failed';

  if p_refund_id is not null then
    select * into v_refund
    from public.refund_records
    where id = p_refund_id and order_id = v_order.id
    for update;

    if not found then
      raise exception 'Refund record % not found for order %.', p_refund_id, v_order.id;
    end if;

    if v_refund.status = 'processed' then
      return query select
        v_refund.id, v_refund.order_id, v_payment.provider_payment_id,
        v_refund.amount_paise, v_refund.currency, true,
        v_refund.provider_refund_id, v_refund.status;
      return;
    end if;

    if v_refund.provider_refund_id is not null and v_refund.status = 'pending' then
      return query select
        v_refund.id, v_refund.order_id, v_payment.provider_payment_id,
        v_refund.amount_paise, v_refund.currency, true,
        v_refund.provider_refund_id, v_refund.status;
      return;
    end if;

    if v_refund.request_status = 'rejected' then
      raise exception 'Rejected refund requests cannot be initiated.';
    end if;

    v_total_request_paise := v_refund.amount_paise;
    if v_reserved_or_processed + v_total_request_paise > v_payment.captured_paise then
      raise exception 'Total pending and processed refunds (% paise) would exceed captured payment amount (% paise).',
        (v_reserved_or_processed + v_total_request_paise), v_payment.captured_paise;
    end if;

    update public.refund_records
    set
      status = 'pending',
      request_status = 'processing',
      approved_by = coalesce(approved_by, p_actor_id),
      approved_at = coalesce(approved_at, now()),
      failure_reason = null,
      provider_refund_id = case when v_refund.status = 'failed' then null else provider_refund_id end,
      idempotency_key = case when v_refund.status = 'failed' then v_idem_key else idempotency_key end,
      updated_at = now()
    where id = v_refund.id
    returning * into v_refund;
  else
    create temp table if not exists _res_refund_items (
      order_item_id uuid not null,
      seller_order_id uuid not null,
      product_id uuid not null,
      variant_id uuid,
      quantity integer not null,
      unit_price_paise bigint not null,
      refund_amount_paise bigint not null,
      restock_eligible boolean not null
    ) on commit drop;
    truncate table _res_refund_items;

    if p_items is not null and jsonb_array_length(p_items) > 0 then
      v_refund_type := 'partial_item';
      for v_item in select * from jsonb_array_elements(p_items)
      loop
        v_qty := (v_item->>'quantity')::integer;
        if v_qty is null or v_qty <= 0 then
          raise exception 'Item refund quantity must be positive.';
        end if;

        select * into v_oi from public.order_items
        where id = (v_item->>'order_item_id')::uuid and order_id = v_order.id
        for update;
        if not found then raise exception 'Order item not found.'; end if;

        select * into v_so from public.seller_orders where id = v_oi.seller_order_id;
        select coalesce(sum(ri.quantity), 0) into v_already_item_qty
        from public.refund_items ri
        join public.refund_records rr on rr.id = ri.refund_id
        where ri.order_item_id = v_oi.id
          and rr.request_status <> 'rejected'
          and rr.status <> 'failed';

        if v_already_item_qty + v_qty > v_oi.quantity then
          raise exception 'Refund quantity exceeds remaining units for %.', v_oi.product_name;
        end if;

        if v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered') then
          v_needs_inspection := true;
        end if;

        v_line_paise := coalesce(v_oi.unit_price_paise, round(v_oi.unit_price * 100)::bigint) * v_qty;
        v_product_refund_paise := v_product_refund_paise + v_line_paise;

        insert into _res_refund_items values (
          v_oi.id, v_oi.seller_order_id, v_oi.product_id, v_oi.variant_id,
          v_qty, coalesce(v_oi.unit_price_paise, round(v_oi.unit_price * 100)::bigint),
          v_line_paise, (v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered'))
        );
      end loop;

      v_total_request_paise := coalesce(p_amount_paise, v_product_refund_paise + v_shipping_paise);
    elsif p_seller_order_id is not null then
      v_refund_type := 'partial_seller_order';
      select * into v_so from public.seller_orders
      where id = p_seller_order_id and order_id = v_order.id
      for update;
      if not found then raise exception 'Seller order not found.'; end if;
      if v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered') then
        v_needs_inspection := true;
      end if;

      v_product_refund_paise := coalesce(p_amount_paise, v_so.subtotal_paise);
      v_total_request_paise := v_product_refund_paise + v_shipping_paise;
    else
      v_total_request_paise := coalesce(p_amount_paise, v_payment.captured_paise - v_reserved_or_processed);
      v_refund_type := case
        when v_total_request_paise < (v_payment.captured_paise - v_reserved_or_processed) then 'partial_seller_order'
        else 'full'
      end;

      select exists (
        select 1 from public.seller_orders
        where order_id = v_order.id and fulfilment_status in ('shipped', 'dispatched', 'delivered')
      ) into v_needs_inspection;
    end if;

    if v_total_request_paise <= 0 then
      raise exception 'Refund amount must be positive.';
    end if;

    if v_reserved_or_processed + v_total_request_paise > v_payment.captured_paise then
      raise exception 'Total pending and processed refunds (% paise) exceed captured payment amount (% paise).',
        (v_reserved_or_processed + v_total_request_paise), v_payment.captured_paise;
    end if;

    insert into public.refund_records (
      order_id, seller_order_id, payment_id, refund_channel, refund_type,
      idempotency_key, amount_paise, shipping_refund_paise, currency,
      status, request_status, reason, initiated_by, approved_by, approved_at,
      refund_method, restock_required, restock_status
    ) values (
      v_order.id, p_seller_order_id, v_payment.id, 'razorpay', v_refund_type,
      v_idem_key, v_total_request_paise, v_shipping_paise, 'INR',
      'pending', 'processing', coalesce(nullif(trim(p_reason), ''), 'Admin initiated refund'),
      p_actor_id, p_actor_id, now(), 'razorpay',
      v_needs_inspection, case when v_needs_inspection then 'pending_inspection' else 'not_applicable' end
    )
    returning * into v_refund;

    insert into public.refund_items (
      refund_id, order_id, seller_order_id, order_item_id,
      product_id, variant_id, quantity, unit_price_paise, refund_amount_paise, restock_eligible
    )
    select
      v_refund.id, v_order.id, seller_order_id, order_item_id,
      product_id, variant_id, quantity, unit_price_paise, refund_amount_paise, restock_eligible
    from _res_refund_items;
  end if;

  -- Ensure per-seller proportional adjustments are prepared if not yet populated
  if not exists (select 1 from public.refund_seller_adjustments where refund_id = v_refund.id) then
    if exists (select 1 from public.refund_items where refund_id = v_refund.id) then
      for v_adj_row in
        select ri.seller_order_id, so.seller_id, sum(ri.refund_amount_paise)::bigint as seller_refund_paise
        from public.refund_items ri
        join public.seller_orders so on so.id = ri.seller_order_id
        where ri.refund_id = v_refund.id
        group by ri.seller_order_id, so.seller_id
      loop
        select * into v_rev from public.internal_calculate_proportional_reversal(v_adj_row.seller_order_id, v_adj_row.seller_refund_paise);
        insert into public.refund_seller_adjustments (
          refund_id, order_id, seller_order_id, seller_id,
          gross_refund_paise, commission_rate_bps,
          commission_reversed_paise, seller_payable_reversed_paise
        ) values (
          v_refund.id, v_order.id, v_adj_row.seller_order_id, v_adj_row.seller_id,
          v_adj_row.seller_refund_paise, v_rev.commission_rate_bps,
          v_rev.commission_reversed_paise, v_rev.seller_payable_reversed_paise
        )
        on conflict (refund_id, seller_order_id) do nothing;
      end loop;
    elsif v_refund.seller_order_id is not null then
      select * into v_so from public.seller_orders where id = v_refund.seller_order_id;
      select * into v_rev from public.internal_calculate_proportional_reversal(v_so.id, least(v_refund.amount_paise, v_so.subtotal_paise));
      insert into public.refund_seller_adjustments (
        refund_id, order_id, seller_order_id, seller_id,
        gross_refund_paise, commission_rate_bps,
        commission_reversed_paise, seller_payable_reversed_paise
      ) values (
        v_refund.id, v_order.id, v_so.id, v_so.seller_id,
        least(v_refund.amount_paise, v_so.subtotal_paise), v_rev.commission_rate_bps,
        v_rev.commission_reversed_paise, v_rev.seller_payable_reversed_paise
      )
      on conflict (refund_id, seller_order_id) do nothing;
    else
      -- Allocate across all seller_orders proportionally against order subtotal
      declare
        v_product_budget bigint := greatest(0, least(v_refund.amount_paise - coalesce(v_refund.shipping_refund_paise, 0), v_order.subtotal_paise));
        v_remaining_budget bigint := v_product_budget;
        v_so_count integer;
        v_idx integer := 0;
        v_share bigint;
      begin
        select count(*) into v_so_count from public.seller_orders where order_id = v_order.id;
        for v_so in select * from public.seller_orders where order_id = v_order.id order by subtotal_paise desc, id asc
        loop
          v_idx := v_idx + 1;
          if v_remaining_budget <= 0 or v_order.subtotal_paise <= 0 then
            exit;
          end if;
          if v_idx = v_so_count then
            v_share := least(v_remaining_budget, v_so.subtotal_paise);
          else
            v_share := least(v_remaining_budget, least(v_so.subtotal_paise, round((v_product_budget::numeric * v_so.subtotal_paise::numeric) / v_order.subtotal_paise::numeric)::bigint));
          end if;
          if v_share > 0 then
            select * into v_rev from public.internal_calculate_proportional_reversal(v_so.id, v_share);
            insert into public.refund_seller_adjustments (
              refund_id, order_id, seller_order_id, seller_id,
              gross_refund_paise, commission_rate_bps,
              commission_reversed_paise, seller_payable_reversed_paise
            ) values (
              v_refund.id, v_order.id, v_so.id, v_so.seller_id,
              v_share, v_rev.commission_rate_bps,
              v_rev.commission_reversed_paise, v_rev.seller_payable_reversed_paise
            )
            on conflict (refund_id, seller_order_id) do nothing;
            v_remaining_budget := v_remaining_budget - v_share;
          end if;
        end loop;
      end;
    end if;
  end if;

  if nullif(trim(coalesce(p_internal_notes, '')), '') is not null then
    insert into public.refund_internal_notes (refund_id, internal_notes, updated_by)
    values (v_refund.id, trim(p_internal_notes), p_actor_id)
    on conflict (refund_id) do update
    set internal_notes = excluded.internal_notes, updated_by = excluded.updated_by, updated_at = now();
  end if;

  perform public.recompute_parent_order_status(v_order.id);
  perform public.internal_emit_notification(
    v_order.customer_id,
    'order_status',
    'Refund Initiated',
    'A refund of INR ' || round(v_refund.amount_paise / 100.0, 2)::text || ' has been initiated for order ' || v_order.order_number || '.'
  );

  return query select
    v_refund.id, v_refund.order_id, v_payment.provider_payment_id,
    v_refund.amount_paise, v_refund.currency, false,
    v_refund.provider_refund_id, v_refund.status;
end;
$$;

revoke all on function public.reserve_online_refund(uuid, uuid, uuid, uuid, jsonb, bigint, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_online_refund(uuid, uuid, uuid, uuid, jsonb, bigint, bigint, text, text, text) to service_role;

-- Finalizes or updates online refund state from Razorpay create-refund response or webhook.
-- Enforces out-of-order safety and exact-once financial ledger postings + seller balance updates.
create or replace function public.finalize_online_refund_state(
  p_refund_id uuid default null,
  p_provider_refund_id text default null,
  p_provider_payment_id text default null,
  p_next_status text default 'pending', -- 'pending' | 'processed' | 'failed'
  p_amount_paise bigint default null,
  p_failure_reason text default null,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  refund_id uuid,
  order_id uuid,
  refund_status text,
  order_payment_status text,
  already_processed boolean,
  ignored_out_of_order boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refund_records%rowtype;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_adj record;
  v_ri record;
  v_entry_group uuid := uuid_generate_v4();
  v_total_refunded bigint := 0;
  v_so public.seller_orders%rowtype;
begin
  if p_next_status not in ('pending', 'processed', 'failed') then
    raise exception 'Unsupported refund state %.', p_next_status;
  end if;

  if p_refund_id is not null then
    select * into v_refund from public.refund_records where id = p_refund_id for update;
  elsif nullif(trim(coalesce(p_provider_refund_id, '')), '') is not null then
    select * into v_refund from public.refund_records where provider_refund_id = trim(p_provider_refund_id) for update;
  end if;

  if not found then
    raise exception 'Matching refund record not found.';
  end if;

  select * into v_order from public.orders where id = v_refund.order_id for update;
  select * into v_payment from public.payments where id = v_refund.payment_id for update;

  -- Out-of-order guard: never downgrade an already processed refund back to pending or failed
  if v_refund.status = 'processed' then
    return query select
      v_refund.id, v_refund.order_id, v_refund.status,
      v_order.payment_status, true, (p_next_status <> 'processed');
    return;
  end if;

  if p_amount_paise is not null and p_amount_paise > 0 and p_amount_paise <> v_refund.amount_paise then
    raise exception 'Webhook refund amount (% paise) does not match reserved refund (% paise).',
      p_amount_paise, v_refund.amount_paise;
  end if;

  if p_next_status = 'pending' then
    update public.refund_records
    set
      provider_refund_id = coalesce(nullif(trim(coalesce(p_provider_refund_id, '')), ''), provider_refund_id),
      status = 'pending',
      request_status = 'processing',
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    where id = v_refund.id
    returning * into v_refund;

    perform public.recompute_parent_order_status(v_order.id);
    select * into v_order from public.orders where id = v_order.id;

    return query select v_refund.id, v_refund.order_id, v_refund.status, v_order.payment_status, false, false;
    return;
  end if;

  if p_next_status = 'failed' then
    update public.refund_records
    set
      provider_refund_id = coalesce(nullif(trim(coalesce(p_provider_refund_id, '')), ''), provider_refund_id),
      status = 'failed',
      request_status = 'failed',
      failure_reason = coalesce(nullif(trim(coalesce(p_failure_reason, '')), ''), 'Razorpay refund failed'),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    where id = v_refund.id
    returning * into v_refund;

    perform public.recompute_parent_order_status(v_order.id);
    select * into v_order from public.orders where id = v_order.id;

    perform public.internal_emit_notification(
      v_order.customer_id,
      'order_status',
      'Refund Failed — Retry Scheduled',
      'Refund processing encountered a gateway error for order ' || v_order.order_number || '. Our team can retry it shortly.'
    );

    insert into public.order_status_history (order_id, seller_order_id, status, note, changed_by)
    values (v_order.id, v_refund.seller_order_id, 'refund_failed', coalesce(v_refund.failure_reason, 'Refund failed'), coalesce(p_actor_id, v_refund.initiated_by));

    return query select v_refund.id, v_refund.order_id, v_refund.status, v_order.payment_status, false, false;
    return;
  end if;

  -- p_next_status = 'processed'
  update public.refund_records
  set
    provider_refund_id = coalesce(nullif(trim(coalesce(p_provider_refund_id, '')), ''), provider_refund_id),
    status = 'processed',
    request_status = 'completed',
    processed_at = coalesce(processed_at, now()),
    failure_reason = null,
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
    updated_at = now()
  where id = v_refund.id
  returning * into v_refund;

  -- Update cumulative payments.refunded_paise
  select coalesce(sum(rr.amount_paise), 0)
  into v_total_refunded
  from public.refund_records rr
  where rr.order_id = v_order.id
    and rr.status = 'processed';

  if found and v_payment.id is not null then
    update public.payments
    set
      refunded_paise = least(captured_paise, v_total_refunded),
      status = case
        when v_total_refunded >= captured_paise then 'refunded'
        when v_total_refunded > 0 then 'partially_refunded'
        else status
      end,
      updated_at = now()
    where id = v_payment.id;
  end if;

  -- Update cumulative refunded item quantities exact-once
  for v_ri in
    select * from public.refund_items where refund_id = v_refund.id
  loop
    update public.order_items
    set
      refunded_quantity = least(quantity, refunded_quantity + v_ri.quantity),
      refunded_paise = refunded_paise + v_ri.refund_amount_paise
    where id = v_ri.order_item_id;
  end loop;

  -- Post order-level gateway refund & refund debit ledger entries exact-once
  insert into public.financial_ledger_entries (
    entry_group_id, order_id, payment_id, refund_id,
    entry_type, direction, amount_paise, description, reference_id, created_by
  ) values
    (
      v_entry_group, v_order.id, v_refund.payment_id, v_refund.id,
      'gateway_refund', 'debit', v_refund.amount_paise,
      'Razorpay refund processed to customer source',
      coalesce(v_refund.provider_refund_id, p_provider_payment_id),
      coalesce(p_actor_id, v_refund.initiated_by)
    ),
    (
      v_entry_group, v_order.id, v_refund.payment_id, v_refund.id,
      'refund_debit', 'debit', v_refund.amount_paise,
      'Order refund debit posted on gateway confirmation',
      coalesce(v_refund.provider_refund_id, v_order.order_number),
      coalesce(p_actor_id, v_refund.initiated_by)
    )
  on conflict do nothing;

  -- Apply proportional seller adjustments & post seller-level reversals exact-once
  for v_adj in
    select * from public.refund_seller_adjustments
    where refund_id = v_refund.id and applied_to_balances = false
    for update
  loop
    update public.seller_orders
    set
      refund_paise = refund_paise + v_adj.gross_refund_paise,
      adjustment_paise = adjustment_paise - v_adj.seller_payable_reversed_paise,
      reversal_paise = reversal_paise + v_adj.seller_payable_reversed_paise,
      outstanding_balance_paise = greatest(0, outstanding_balance_paise - v_adj.seller_payable_reversed_paise),
      updated_at = now()
    where id = v_adj.seller_order_id
    returning * into v_so;

    -- Restock ONLY if item/seller_order has never shipped/dispatched/delivered AND full seller order cancelled
    if v_so.fulfilment_status not in ('shipped', 'dispatched', 'delivered')
       and v_so.refund_paise >= v_so.subtotal_paise
       and v_refund.restock_required = false then
      perform public.internal_restore_seller_order_inventory(v_so.id);
      update public.seller_orders
      set
        fulfilment_status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        cancellation_reason = coalesce(cancellation_reason, v_refund.reason),
        updated_at = now()
      where id = v_so.id and fulfilment_status <> 'cancelled';
    end if;

    if v_adj.commission_reversed_paise > 0 then
      insert into public.financial_ledger_entries (
        entry_group_id, order_id, seller_order_id, seller_id, payment_id, refund_id,
        entry_type, direction, amount_paise, commission_rate_bps,
        description, reference_id, created_by
      ) values (
        v_entry_group, v_order.id, v_adj.seller_order_id, v_adj.seller_id, v_refund.payment_id, v_refund.id,
        'commission_reversal', 'debit', v_adj.commission_reversed_paise, v_adj.commission_rate_bps,
        'Proportional historical commission reversed on refund',
        coalesce(v_refund.provider_refund_id, v_order.order_number),
        coalesce(p_actor_id, v_refund.initiated_by)
      )
      on conflict do nothing;
    end if;

    if v_adj.seller_payable_reversed_paise > 0 then
      insert into public.financial_ledger_entries (
        entry_group_id, order_id, seller_order_id, seller_id, payment_id, refund_id,
        entry_type, direction, amount_paise, commission_rate_bps,
        description, reference_id, created_by
      ) values (
        v_entry_group, v_order.id, v_adj.seller_order_id, v_adj.seller_id, v_refund.payment_id, v_refund.id,
        'seller_payable_reversal', 'debit', v_adj.seller_payable_reversed_paise, v_adj.commission_rate_bps,
        'Proportional seller payable reversed on refund',
        coalesce(v_refund.provider_refund_id, v_order.order_number),
        coalesce(p_actor_id, v_refund.initiated_by)
      )
      on conflict do nothing;
    end if;

    update public.refund_seller_adjustments
    set applied_to_balances = true, applied_at = now()
    where id = v_adj.id;
  end loop;

  perform public.recompute_parent_order_status(v_order.id);
  select * into v_order from public.orders where id = v_order.id;

  perform public.internal_emit_notification(
    v_order.customer_id,
    'order_status',
    'Refund Processed',
    'Refund of INR ' || round(v_refund.amount_paise / 100.0, 2)::text || ' for order ' || v_order.order_number || ' has been processed.'
  );

  insert into public.order_status_history (order_id, seller_order_id, status, note, changed_by)
  values (
    v_order.id,
    v_refund.seller_order_id,
    v_order.payment_status,
    'Refund processed (' || coalesce(v_refund.provider_refund_id, v_refund.id::text) || '): INR ' || round(v_refund.amount_paise / 100.0, 2)::text,
    coalesce(p_actor_id, v_refund.initiated_by)
  );

  return query select v_refund.id, v_refund.order_id, v_refund.status, v_order.payment_status, false, false;
end;
$$;

revoke all on function public.finalize_online_refund_state(uuid, text, text, text, bigint, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_online_refund_state(uuid, text, text, text, bigint, text, uuid, jsonb) to service_role;

-- ============================================================================
-- 5. COD CANCELLATION ACCOUNTING & EXPLICIT MANUAL COD REFUND WORKFLOW
-- ============================================================================

-- Handles COD seller-order cancellation across pre-collection, post-dispatch, and failed delivery/RTO.
-- Never issues a cash refund when no COD cash was collected, and never auto-restores stock on
-- dispatched/delivered/RTO parcels without explicit physical inspection.
create or replace function public.cancel_cod_seller_order_with_accounting(
  p_seller_order_id uuid,
  p_stage text, -- 'before_collection' | 'after_dispatch' | 'failed_delivery_rto'
  p_reason text default 'COD order cancelled',
  p_courier_deduction_paise bigint default 0,
  p_courier_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_so public.seller_orders%rowtype;
  v_order public.orders%rowtype;
  v_cod public.cod_collection_records%rowtype;
  v_courier_fee bigint := greatest(0, coalesce(p_courier_deduction_paise, 0));
  v_entry_group uuid := uuid_generate_v4();
  v_comm_bps integer;
  v_seller_user_id uuid;
begin
  if v_uid is null or not public.is_operations_admin(v_uid) then
    raise exception 'Only operations or super administrators can perform COD cancellation accounting.';
  end if;

  if p_stage not in ('before_collection', 'after_dispatch', 'failed_delivery_rto') then
    raise exception 'Invalid COD cancellation stage %.', p_stage;
  end if;

  select * into v_so from public.seller_orders where id = p_seller_order_id for update;
  if not found then
    raise exception 'Seller order not found.';
  end if;

  select * into v_order from public.orders where id = v_so.order_id for update;
  if v_order.payment_method <> 'cod' then
    raise exception 'Use online refund workflow for non-COD orders.';
  end if;

  select * into v_cod from public.cod_collection_records where seller_order_id = v_so.id for update;

  if found and (v_cod.collection_status in ('collected', 'remitted') or coalesce(v_cod.collected_amount_paise, 0) > 0) then
    raise exception 'Cash has already been collected for this COD order; record a manual COD refund instead.';
  end if;

  if p_stage = 'before_collection' and v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered') then
    raise exception 'Dispatched or delivered COD orders must use after_dispatch or failed_delivery_rto cancellation stages.';
  end if;

  if p_stage = 'before_collection' then
    perform public.internal_restore_seller_order_inventory(v_so.id);
  end if;

  v_comm_bps := greatest(0, least(5000, round(coalesce(v_so.commission_rate_snapshot, 0.1200) * 10000)::integer));

  update public.seller_orders
  set
    fulfilment_status = 'cancelled',
    cod_reconciliation_status = 'cancelled',
    reversal_paise = seller_payable_paise,
    outstanding_balance_paise = 0,
    cancelled_at = coalesce(cancelled_at, now()),
    cancelled_by = coalesce(cancelled_by, v_uid),
    cancellation_reason = coalesce(nullif(trim(p_reason), ''), 'COD cancelled (' || p_stage || ')'),
    updated_at = now()
  where id = v_so.id;

  if found then
    update public.cod_collection_records
    set
      collection_status = case when p_stage = 'failed_delivery_rto' then 'failed_delivery' else 'cancelled' end,
      reconciliation_status = 'cancelled',
      cod_cancellation_stage = p_stage,
      courier_name = coalesce(nullif(trim(coalesce(p_courier_name, '')), ''), courier_name),
      courier_charges_paise = courier_charges_paise + v_courier_fee,
      courier_deduction_paise = courier_deduction_paise + v_courier_fee,
      outstanding_amount_paise = 0,
      updated_by = v_uid,
      notes = coalesce(nullif(trim(p_reason), ''), notes),
      updated_at = now()
    where id = v_cod.id;
  end if;

  -- Record ledger adjustments without inventing a cash refund (cash was never collected)
  if v_so.commission_amount_paise > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, cod_record_id,
      entry_type, direction, amount_paise, commission_rate_bps,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_cod.id,
      'commission_reversal', 'debit', v_so.commission_amount_paise, v_comm_bps,
      'COD pre-collection commission obligation cancelled (' || p_stage || ')',
      v_order.order_number, v_uid
    );
  end if;

  if v_so.seller_payable_paise > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, cod_record_id,
      entry_type, direction, amount_paise, commission_rate_bps,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_cod.id,
      'seller_payable_reversal', 'debit', v_so.seller_payable_paise, v_comm_bps,
      'COD uncollected seller payable cancelled (' || p_stage || ')',
      v_order.order_number, v_uid
    );
  end if;

  if v_courier_fee > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, cod_record_id,
      entry_type, direction, amount_paise,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_cod.id,
      'courier_adjustment', 'debit', v_courier_fee,
      'COD RTO / forward-return courier deduction (' || p_stage || ')',
      coalesce(nullif(trim(coalesce(p_courier_name, '')), ''), v_order.order_number), v_uid
    );
  end if;

  perform public.recompute_parent_order_status(v_order.id);

  select sp.user_id into v_seller_user_id from public.seller_profiles sp where sp.id = v_so.seller_id;
  perform public.internal_emit_notification(
    v_order.customer_id,
    'order_status',
    'COD Order Cancelled',
    'Your COD order ' || v_order.order_number || ' was cancelled (' || replace(p_stage, '_', ' ') || '). No online refund is required since cash was not collected.'
  );
  perform public.internal_emit_notification(
    v_seller_user_id,
    'order_status',
    'COD Shipment Cancelled (' || replace(p_stage, '_', ' ') || ')',
    'COD order ' || v_order.order_number || ' cancelled at stage ' || p_stage || '.'
  );

  insert into public.audit_logs (actor_id, action, target_table, target_id, details)
  values (
    v_uid,
    'CANCEL_COD_WITH_ACCOUNTING',
    'cod_collection_records',
    coalesce(v_cod.id, v_so.id),
    jsonb_build_object(
      'order_id', v_order.id,
      'seller_order_id', v_so.id,
      'stage', p_stage,
      'courier_deduction_paise', v_courier_fee,
      'inventory_auto_restored', (p_stage = 'before_collection')
    )
  );

  return jsonb_build_object(
    'seller_order_id', v_so.id,
    'stage', p_stage,
    'inventory_restored', (p_stage = 'before_collection'),
    'cash_refund_paise', 0,
    'courier_deduction_paise', v_courier_fee
  );
end;
$$;

revoke all on function public.cancel_cod_seller_order_with_accounting(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.cancel_cod_seller_order_with_accounting(uuid, text, text, bigint, text) to authenticated;

-- Explicit manual refund workflow AFTER COD cash collection.
-- Never invokes Razorpay; requires collected COD cash, non-empty reference, and idempotency key.
create or replace function public.record_manual_cod_refund(
  p_order_id uuid,
  p_seller_order_id uuid,
  p_amount_paise bigint,
  p_refund_method text,
  p_manual_reference text,
  p_refund_date timestamptz default now(),
  p_reason text default 'Manual COD refund after collection',
  p_idempotency_key text default null,
  p_internal_notes text default null,
  p_courier_deduction_paise bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_so public.seller_orders%rowtype;
  v_cod public.cod_collection_records%rowtype;
  v_refund_id uuid;
  v_existing_id uuid;
  v_idem_key text;
  v_rev record;
  v_entry_group uuid := uuid_generate_v4();
  v_courier_fee bigint := greatest(0, coalesce(p_courier_deduction_paise, 0));
  v_seller_user_id uuid;
begin
  if v_uid is null or not public.is_operations_admin(v_uid) then
    raise exception 'Only operations or super administrators can record manual COD refunds.';
  end if;

  if nullif(trim(coalesce(p_manual_reference, '')), '') is null then
    raise exception 'Manual refund reference ID (bank/UPI/voucher reference) is required for COD refunds.';
  end if;

  if nullif(trim(coalesce(p_refund_method, '')), '') is null then
    raise exception 'Refund method is required for manual COD refunds.';
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Manual COD refund amount must be positive.';
  end if;

  v_idem_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'cod-rfnd:' || p_seller_order_id::text || ':' || trim(p_manual_reference)
  );

  select id into v_existing_id from public.refund_records where idempotency_key = v_idem_key;
  if found then
    return v_existing_id;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.payment_method <> 'cod' then
    raise exception 'Manual COD refunds apply only to existing COD orders.';
  end if;

  select * into v_so from public.seller_orders
  where id = p_seller_order_id and order_id = v_order.id
  for update;
  if not found then
    raise exception 'Seller order not found for this COD order.';
  end if;

  select * into v_cod from public.cod_collection_records where seller_order_id = v_so.id for update;
  if not found or v_cod.collection_status not in ('collected', 'remitted') or coalesce(v_cod.collected_amount_paise, 0) <= 0 then
    raise exception 'COD cash must be marked collected or remitted before recording a manual cash refund.';
  end if;

  if v_cod.refunded_amount_paise + p_amount_paise > v_cod.collected_amount_paise then
    raise exception 'Manual COD refund (% paise) exceeds remaining collected cash (% paise).',
      p_amount_paise, (v_cod.collected_amount_paise - v_cod.refunded_amount_paise);
  end if;

  insert into public.refund_records (
    order_id, seller_order_id, refund_channel, refund_type,
    idempotency_key, amount_paise, currency, status, request_status,
    reason, initiated_by, approved_by, approved_at, processed_at,
    refund_method, manual_reference, manual_refund_date,
    courier_deduction_paise, restock_required, restock_status
  ) values (
    v_order.id, v_so.id, 'cod_manual', 'cod_manual',
    v_idem_key, p_amount_paise, 'INR', 'processed', 'completed',
    coalesce(nullif(trim(p_reason), ''), 'Manual COD refund'),
    v_uid, v_uid, now(), coalesce(p_refund_date, now()),
    trim(p_refund_method), trim(p_manual_reference), coalesce(p_refund_date, now()),
    v_courier_fee, true, 'pending_inspection'
  )
  returning id into v_refund_id;

  select * into v_rev from public.internal_calculate_proportional_reversal(v_so.id, least(p_amount_paise, v_so.subtotal_paise));

  insert into public.refund_seller_adjustments (
    refund_id, order_id, seller_order_id, seller_id,
    gross_refund_paise, commission_rate_bps,
    commission_reversed_paise, seller_payable_reversed_paise, courier_deduction_paise,
    applied_to_balances, applied_at
  ) values (
    v_refund_id, v_order.id, v_so.id, v_so.seller_id,
    p_amount_paise, v_rev.commission_rate_bps,
    v_rev.commission_reversed_paise, v_rev.seller_payable_reversed_paise, v_courier_fee,
    true, now()
  );

  if nullif(trim(coalesce(p_internal_notes, '')), '') is not null then
    insert into public.refund_internal_notes (refund_id, internal_notes, updated_by)
    values (v_refund_id, trim(p_internal_notes), v_uid);
  end if;

  update public.cod_collection_records
  set
    refunded_amount_paise = refunded_amount_paise + p_amount_paise,
    cod_cancellation_stage = 'manual_refund_after_collection',
    courier_deduction_paise = courier_deduction_paise + v_courier_fee,
    manual_refund_reference = trim(p_manual_reference),
    manual_refund_method = trim(p_refund_method),
    manual_refund_date = coalesce(p_refund_date, now()),
    outstanding_amount_paise = greatest(0, outstanding_amount_paise - v_rev.seller_payable_reversed_paise),
    updated_by = v_uid,
    updated_at = now()
  where id = v_cod.id;

  update public.seller_orders
  set
    refund_paise = refund_paise + p_amount_paise,
    adjustment_paise = adjustment_paise - v_rev.seller_payable_reversed_paise,
    reversal_paise = reversal_paise + v_rev.seller_payable_reversed_paise,
    outstanding_balance_paise = greatest(0, outstanding_balance_paise - v_rev.seller_payable_reversed_paise),
    updated_at = now()
  where id = v_so.id;

  insert into public.financial_ledger_entries (
    entry_group_id, order_id, seller_order_id, seller_id, refund_id, cod_record_id,
    entry_type, direction, amount_paise, commission_rate_bps,
    description, reference_id, created_by
  ) values (
    v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_refund_id, v_cod.id,
    'cod_refund', 'debit', p_amount_paise, v_rev.commission_rate_bps,
    'Explicit manual COD refund issued (' || trim(p_refund_method) || ')',
    trim(p_manual_reference), v_uid
  );

  if v_rev.commission_reversed_paise > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, refund_id, cod_record_id,
      entry_type, direction, amount_paise, commission_rate_bps,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_refund_id, v_cod.id,
      'commission_reversal', 'debit', v_rev.commission_reversed_paise, v_rev.commission_rate_bps,
      'Proportional historical commission reversed on manual COD refund',
      trim(p_manual_reference), v_uid
    );
  end if;

  if v_rev.seller_payable_reversed_paise > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, refund_id, cod_record_id,
      entry_type, direction, amount_paise, commission_rate_bps,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_refund_id, v_cod.id,
      'seller_payable_reversal', 'debit', v_rev.seller_payable_reversed_paise, v_rev.commission_rate_bps,
      'Seller payable reversed on manual COD refund',
      trim(p_manual_reference), v_uid
    );
  end if;

  if v_courier_fee > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, refund_id, cod_record_id,
      entry_type, direction, amount_paise,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_refund_id, v_cod.id,
      'courier_adjustment', 'debit', v_courier_fee,
      'Return courier deduction recorded on COD refund',
      trim(p_manual_reference), v_uid
    );
  end if;

  perform public.recompute_parent_order_status(v_order.id);

  select sp.user_id into v_seller_user_id from public.seller_profiles sp where sp.id = v_so.seller_id;
  perform public.internal_emit_notification(
    v_order.customer_id,
    'order_status',
    'Manual COD Refund Processed',
    'A refund of INR ' || round(p_amount_paise / 100.0, 2)::text || ' via ' || trim(p_refund_method) || ' (Ref: ' || trim(p_manual_reference) || ') has been recorded for order ' || v_order.order_number || '.'
  );
  perform public.internal_emit_notification(
    v_seller_user_id,
    'order_status',
    'COD Refund Adjustment Recorded',
    'A manual COD refund adjustment was recorded for order ' || v_order.order_number || '.'
  );

  insert into public.audit_logs (actor_id, action, target_table, target_id, details)
  values (
    v_uid,
    'RECORD_MANUAL_COD_REFUND',
    'refund_records',
    v_refund_id,
    jsonb_build_object(
      'order_id', v_order.id,
      'seller_order_id', v_so.id,
      'amount_paise', p_amount_paise,
      'refund_method', trim(p_refund_method),
      'manual_reference', trim(p_manual_reference),
      'commission_reversed_paise', v_rev.commission_reversed_paise,
      'seller_payable_reversed_paise', v_rev.seller_payable_reversed_paise
    )
  );

  return v_refund_id;
end;
$$;

revoke all on function public.record_manual_cod_refund(uuid, uuid, bigint, text, text, timestamptz, text, text, text, bigint) from public, anon;
grant execute on function public.record_manual_cod_refund(uuid, uuid, bigint, text, text, timestamptz, text, text, text, bigint) to authenticated;

-- ============================================================================
-- 6. EXPLICIT INSPECTION-GATED RETURNED ITEM RESTOCKING (EXACT-ONCE)
-- ============================================================================

create or replace function public.approve_returned_item_restock(
  p_refund_id uuid default null,
  p_return_id uuid default null,
  p_decision text default 'restocked', -- 'restocked' | 'rejected_damaged'
  p_inspection_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_ops_admin boolean := public.is_operations_admin(v_uid);
  v_refund public.refund_records%rowtype;
  v_ret public.returns%rowtype;
  v_ri record;
  v_oi public.order_items%rowtype;
  v_seller_user_id uuid;
  v_restocked_units integer := 0;
  v_target_order_id uuid;
  v_target_seller_order_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if p_decision not in ('restocked', 'rejected_damaged') then
    raise exception 'Invalid restock inspection decision %. Expected restocked or rejected_damaged.', p_decision;
  end if;

  if p_refund_id is not null then
    select * into v_refund from public.refund_records where id = p_refund_id for update;
    if not found then
      raise exception 'Refund record not found.';
    end if;

    v_target_order_id := v_refund.order_id;
    v_target_seller_order_id := v_refund.seller_order_id;

    if not v_is_ops_admin then
      if v_target_seller_order_id is null then
        raise exception 'Only operations or super administrators can inspect multi-seller refund restocking.';
      end if;
      select sp.user_id into v_seller_user_id
      from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = v_target_seller_order_id;
      if v_seller_user_id is distinct from v_uid then
        raise exception 'You are not authorized to inspect restocking for this refund.';
      end if;
    end if;

    if v_refund.restock_status in ('restocked', 'rejected_damaged') then
      return jsonb_build_object(
        'refund_id', v_refund.id,
        'restock_status', v_refund.restock_status,
        'already_inspected', true,
        'restocked_units', 0
      );
    end if;

    if p_decision = 'restocked' then
      if exists (select 1 from public.refund_items where refund_id = v_refund.id) then
        for v_ri in
          select * from public.refund_items
          where refund_id = v_refund.id and restocked_quantity < quantity
          for update
        loop
          select * into v_oi from public.order_items where id = v_ri.order_item_id for update;
          if v_oi.restocked_quantity + (v_ri.quantity - v_ri.restocked_quantity) <= v_oi.quantity
             and v_oi.inventory_restored = false then
            if v_ri.variant_id is not null then
              update public.product_variants
              set stock_quantity = stock_quantity + (v_ri.quantity - v_ri.restocked_quantity)
              where id = v_ri.variant_id;
            else
              update public.products
              set
                stock_quantity = stock_quantity + (v_ri.quantity - v_ri.restocked_quantity),
                availability = case
                  when availability = 'Out of Stock' and (stock_quantity + (v_ri.quantity - v_ri.restocked_quantity)) > 0 then 'In Stock'
                  else availability
                end
              where id = v_ri.product_id;
            end if;

            update public.order_items
            set
              restocked_quantity = restocked_quantity + (v_ri.quantity - v_ri.restocked_quantity),
              inventory_restored = ((restocked_quantity + (v_ri.quantity - v_ri.restocked_quantity)) >= quantity)
            where id = v_oi.id;

            v_restocked_units := v_restocked_units + (v_ri.quantity - v_ri.restocked_quantity);
          end if;

          update public.refund_items
          set
            restocked_quantity = quantity,
            restocked_at = now(),
            restocked_by = v_uid
          where id = v_ri.id;
        end loop;
      elsif v_refund.seller_order_id is not null then
        for v_oi in
          select * from public.order_items
          where seller_order_id = v_refund.seller_order_id and inventory_restored = false
          for update
        loop
          if v_oi.variant_id is not null then
            update public.product_variants
            set stock_quantity = stock_quantity + (v_oi.quantity - v_oi.restocked_quantity)
            where id = v_oi.variant_id;
          else
            update public.products
            set
              stock_quantity = stock_quantity + (v_oi.quantity - v_oi.restocked_quantity),
              availability = case
                when availability = 'Out of Stock' and (stock_quantity + (v_oi.quantity - v_oi.restocked_quantity)) > 0 then 'In Stock'
                else availability
              end
            where id = v_oi.product_id;
          end if;

          v_restocked_units := v_restocked_units + (v_oi.quantity - v_oi.restocked_quantity);
          update public.order_items
          set restocked_quantity = quantity, inventory_restored = true
          where id = v_oi.id;
        end loop;
      end if;
    end if;

    update public.refund_records
    set
      restock_status = p_decision,
      restocked_at = now(),
      restocked_by = v_uid,
      updated_at = now()
    where id = v_refund.id;

    insert into public.order_status_history (order_id, seller_order_id, status, note, changed_by)
    values (
      v_target_order_id,
      v_target_seller_order_id,
      p_decision,
      coalesce(nullif(trim(coalesce(p_inspection_notes, '')), ''), 'Returned item inspection: ' || p_decision),
      v_uid
    );

    if v_is_ops_admin then
      insert into public.audit_logs (actor_id, action, target_table, target_id, details)
      values (
        v_uid,
        'APPROVE_RETURN_RESTOCK',
        'refund_records',
        v_refund.id,
        jsonb_build_object('decision', p_decision, 'restocked_units', v_restocked_units, 'notes', p_inspection_notes)
      );
    end if;

    return jsonb_build_object(
      'refund_id', v_refund.id,
      'restock_status', p_decision,
      'already_inspected', false,
      'restocked_units', v_restocked_units
    );
  end if;

  if p_return_id is not null then
    select * into v_ret from public.returns where id = p_return_id for update;
    if not found then raise exception 'Return record not found.'; end if;

    select sp.user_id, so.order_id into v_seller_user_id, v_target_order_id
    from public.seller_orders so
    join public.seller_profiles sp on sp.id = so.seller_id
    where so.id = v_ret.seller_order_id;

    if not v_is_ops_admin and v_seller_user_id is distinct from v_uid then
      raise exception 'Not authorized to inspect restock for this return.';
    end if;

    if v_ret.restock_status in ('restocked', 'rejected_damaged') then
      return jsonb_build_object('return_id', v_ret.id, 'restock_status', v_ret.restock_status, 'already_inspected', true, 'restocked_units', 0);
    end if;

    if p_decision = 'restocked' then
      for v_oi in
        select * from public.order_items
        where seller_order_id = v_ret.seller_order_id and inventory_restored = false
        for update
      loop
        if v_oi.variant_id is not null then
          update public.product_variants
          set stock_quantity = stock_quantity + (v_oi.quantity - v_oi.restocked_quantity)
          where id = v_oi.variant_id;
        else
          update public.products
          set
            stock_quantity = stock_quantity + (v_oi.quantity - v_oi.restocked_quantity),
            availability = case
              when availability = 'Out of Stock' and (stock_quantity + (v_oi.quantity - v_oi.restocked_quantity)) > 0 then 'In Stock'
              else availability
            end
          where id = v_oi.product_id;
        end if;
        v_restocked_units := v_restocked_units + (v_oi.quantity - v_oi.restocked_quantity);
        update public.order_items set restocked_quantity = quantity, inventory_restored = true where id = v_oi.id;
      end loop;
    end if;

    update public.returns
    set
      restock_status = p_decision,
      inspection_notes = p_inspection_notes,
      inspected_by = v_uid,
      inspected_at = now(),
      updated_at = now()
    where id = v_ret.id;

    return jsonb_build_object('return_id', v_ret.id, 'restock_status', p_decision, 'already_inspected', false, 'restocked_units', v_restocked_units);
  end if;

  raise exception 'Either p_refund_id or p_return_id must be provided.';
end;
$$;

revoke all on function public.approve_returned_item_restock(uuid, uuid, text, text) from public, anon;
grant execute on function public.approve_returned_item_restock(uuid, uuid, text, text) to authenticated;

-- Harden cancellation guard & RPCs so shipped/dispatched/delivered items NEVER auto-restore inventory
create or replace function public.guard_seller_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_status = 'cancelled' and old.fulfilment_status <> 'cancelled' then
    -- Pre-dispatch cancellations must always restore inventory atomically.
    -- Shipped/dispatched/delivered cancellations MUST NOT auto-restore inventory;
    -- they require authorized ops-admin accounting / inspection-gated restock.
    if old.fulfilment_status not in ('shipped', 'dispatched', 'delivered') then
      if exists (
        select 1 from public.order_items oi
        where oi.seller_order_id = new.id and oi.inventory_restored = false
      ) then
        raise exception 'Orders must be cancelled through cancel_seller_order() or cancel_customer_order() so inventory is restored.';
      end if;
    elsif not public.is_operations_admin(auth.uid()) then
      raise exception 'Shipped, dispatched, or delivered seller orders cannot be cancelled directly.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.cancel_seller_order(
  p_seller_order_id uuid,
  p_reason text default 'Cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_so public.seller_orders%rowtype;
  v_is_ops_admin boolean := public.is_operations_admin(v_uid);
  v_is_owner_seller boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_so from public.seller_orders where id = p_seller_order_id for update;
  if not found then
    raise exception 'Seller order not found.';
  end if;

  if v_so.fulfilment_status = 'cancelled' then
    return jsonb_build_object('seller_order_id', v_so.id, 'status', 'already_cancelled');
  end if;

  select exists (
    select 1 from public.seller_profiles sp
    where sp.id = v_so.seller_id and sp.user_id = v_uid
  ) into v_is_owner_seller;

  if not v_is_owner_seller and not v_is_ops_admin then
    raise exception 'You are not authorized to cancel this seller order.';
  end if;

  if v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered') then
    raise exception 'Shipped, dispatched, or delivered seller orders cannot auto-restore stock on cancellation; use the returns, COD RTO, or refund inspection workflow.';
  end if;

  perform public.internal_restore_seller_order_inventory(v_so.id);

  update public.seller_orders
  set
    fulfilment_status = 'cancelled',
    cod_reconciliation_status = case
      when cod_reconciliation_status = 'awaiting_collection' then 'cancelled'
      else cod_reconciliation_status
    end,
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancellation_reason = coalesce(nullif(trim(p_reason), ''), 'Cancelled'),
    updated_at = now()
  where id = v_so.id;

  perform public.recompute_parent_order_status(v_so.order_id);

  insert into public.order_status_history (order_id, seller_order_id, status, note, changed_by)
  values (
    v_so.order_id,
    v_so.id,
    'cancelled',
    coalesce(nullif(trim(p_reason), ''), 'Seller fulfilment cancelled and stock restored'),
    v_uid
  );

  return jsonb_build_object('seller_order_id', v_so.id, 'status', 'cancelled');
end;
$$;

create or replace function public.cancel_customer_order(
  p_order_id uuid,
  p_reason text default 'Cancelled by customer'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_is_ops_admin boolean := public.is_operations_admin(v_uid);
  v_so record;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.customer_id <> v_uid and not v_is_ops_admin then
    raise exception 'You are not authorized to cancel this order.';
  end if;

  if v_order.order_status = 'cancelled' then
    return jsonb_build_object('order_id', v_order.id, 'status', 'already_cancelled');
  end if;

  if not v_is_ops_admin then
    if v_order.order_status not in ('pending', 'pending_payment', 'confirmed', 'processing') then
      raise exception 'Order can no longer be cancelled at stage %.', v_order.order_status;
    end if;

    if exists (
      select 1 from public.seller_orders
      where order_id = v_order.id
        and fulfilment_status in ('packed', 'ready_to_dispatch', 'shipped', 'dispatched', 'delivered')
    ) then
      raise exception 'One or more seller shipments are already packed or dispatched.';
    end if;
  else
    if exists (
      select 1 from public.seller_orders
      where order_id = v_order.id and fulfilment_status in ('shipped', 'dispatched', 'delivered')
    ) then
      raise exception 'Shipped, dispatched, or delivered shipments cannot auto-restore inventory on direct cancellation; use the COD RTO or refund inspection workflow.';
    end if;
  end if;

  for v_so in
    select id from public.seller_orders
    where order_id = v_order.id and fulfilment_status <> 'cancelled'
    order by id
    for update
  loop
    perform public.internal_restore_seller_order_inventory(v_so.id);

    update public.seller_orders
    set
      fulfilment_status = 'cancelled',
      cod_reconciliation_status = case
        when cod_reconciliation_status = 'awaiting_collection' then 'cancelled'
        else cod_reconciliation_status
      end,
      cancelled_at = now(),
      cancelled_by = v_uid,
      cancellation_reason = coalesce(nullif(trim(p_reason), ''), 'Cancelled'),
      updated_at = now()
    where id = v_so.id;
  end loop;

  update public.orders
  set
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancellation_reason = coalesce(nullif(trim(p_reason), ''), 'Cancelled')
  where id = v_order.id;

  perform public.recompute_parent_order_status(v_order.id);

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (
    v_order.id,
    'cancelled',
    coalesce(nullif(trim(p_reason), ''), 'Order cancelled and inventory restored'),
    v_uid
  );

  return jsonb_build_object('order_id', v_order.id, 'status', 'cancelled');
end;
$$;

commit;
