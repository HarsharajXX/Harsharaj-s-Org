-- NOHAJ Marketplace — Stage 7.8.2: Razorpay Checkout & Server-Side Verification
-- Migration: 009_razorpay_checkout_verification.sql
-- Depends on: 001_initial_schema.sql through 008_payment_and_settlement_foundation.sql.
-- Safe to rerun: Yes (forward-only, transaction-wrapped, precondition-checked, idempotent).
--
-- Scope:
--   - Enables Standard Checkout online payments flag in payment_gateway_config while
--     strictly preserving razorpay_route_enabled = false and route_approval_status = 'not_approved'.
--   - Enforces unique partial ledger constraints so captured payments never duplicate
--     financial ledger postings under concurrent callback + webhook execution.
--   - Provides service_role-only SECURITY DEFINER RPCs for atomic payment attempt recording,
--     exact-once capture finalization, and out-of-order intermediate/failure state handling.

begin;

-- ============================================================================
-- 0. PRECONDITION CHECKS (VERIFY 008 IS APPLIED)
-- ============================================================================

do $$
begin
  if to_regclass('public.payment_gateway_config') is null
     or to_regclass('public.payment_attempts') is null
     or to_regclass('public.payment_webhook_events') is null
     or to_regclass('public.financial_ledger_entries') is null
     or to_regprocedure('public.reserve_online_order_inventory(uuid, jsonb, jsonb, text, integer)') is null
     or to_regprocedure('public.release_expired_online_order_inventory(uuid, text)') is null then
    raise exception 'Precondition failed: migration 008_payment_and_settlement_foundation.sql must be applied before 009_razorpay_checkout_verification.sql.';
  end if;
end $$;

-- ============================================================================
-- 1. KEEP ONLINE PAYMENTS DISABLED BY DEFAULT UNTIL STAGING VERIFICATION
-- ============================================================================
-- Online payments stay disabled (false) until migration 009, Edge Function
-- secrets, all 4 Edge Functions, sandbox tests, and webhooks are verified,
-- and an authorized super_admin explicitly flips online_payments_enabled = true.
-- Razorpay Route remains disabled in all cases for Stage 7.8.2.

update public.payment_gateway_config
set
  online_payments_enabled = false,
  razorpay_route_enabled = false,
  route_approval_status = case
    when route_approval_status = 'approved' then 'not_approved'
    else route_approval_status
  end,
  updated_at = now()
where id = 1;

-- ============================================================================
-- 2. EXACT-ONCE LEDGER & PAYMENT UNIQUENESS GUARANTEES
-- ============================================================================

create unique index if not exists idx_payments_unique_online_order
  on public.payments(order_id)
  where provider = 'razorpay';

create unique index if not exists idx_ledger_unique_order_capture_type
  on public.financial_ledger_entries(order_id, entry_type)
  where entry_type in ('payment_captured', 'shipping_allocation', 'gateway_fee');

create unique index if not exists idx_ledger_unique_seller_order_accrual_type
  on public.financial_ledger_entries(seller_order_id, entry_type)
  where seller_order_id is not null
    and entry_type in ('order_charge', 'commission_accrual', 'seller_payable_credit');

-- ============================================================================
-- 3. ATOMIC SERVICE-ROLE PAYMENT ATTEMPT & CAPTURE RPCS
-- ============================================================================

-- Records a newly created Razorpay Order on a reserved pending_payment order.
create or replace function public.register_razorpay_payment_attempt(
  p_order_id uuid,
  p_customer_id uuid,
  p_provider_order_id text,
  p_amount_paise bigint,
  p_currency text,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  payment_id uuid,
  attempt_id uuid,
  attempt_number integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_next_attempt integer := 1;
begin
  if nullif(trim(coalesce(p_provider_order_id, '')), '') is null then
    raise exception 'provider_order_id is required.';
  end if;

  if p_currency <> 'INR' then
    raise exception 'Unsupported currency %.', p_currency;
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.customer_id <> p_customer_id then
    raise exception 'Order ownership mismatch.';
  end if;

  if v_order.payment_method <> 'online' then
    raise exception 'Order is not an online payment order.';
  end if;

  if v_order.payment_status in ('paid', 'captured', 'refund_pending', 'refunded', 'partially_refunded') then
    raise exception 'Order has already been paid.';
  end if;

  if v_order.order_status in ('expired', 'cancelled') or v_order.reservation_released_at is not null then
    raise exception 'Order reservation has expired or been cancelled.';
  end if;

  if v_order.total_paise <> p_amount_paise then
    raise exception 'Payment amount mismatch against authoritative order total.';
  end if;

  select * into v_attempt
  from public.payment_attempts pa
  where pa.provider_order_id = p_provider_order_id
  for update;

  if found then
    return query select v_attempt.payment_id, v_attempt.id, v_attempt.attempt_number;
    return;
  end if;

  select * into v_payment
  from public.payments p
  where p.order_id = p_order_id and p.provider = 'razorpay'
  for update;

  if not found then
    insert into public.payments (
      order_id, customer_id, provider, provider_order_id,
      amount, amount_paise, currency, status,
      idempotency_key, expires_at, metadata
    ) values (
      p_order_id, p_customer_id, 'razorpay', p_provider_order_id,
      (p_amount_paise / 100.0)::numeric(10, 2), p_amount_paise, p_currency, 'created',
      p_idempotency_key, p_expires_at, coalesce(p_metadata, '{}'::jsonb)
    )
    returning * into v_payment;
  else
    update public.payments
    set
      provider_order_id = p_provider_order_id,
      status = case when status in ('captured', 'authorized') then status else 'created' end,
      expires_at = coalesce(p_expires_at, expires_at),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    where id = v_payment.id
    returning * into v_payment;
  end if;

  select coalesce(max(pa.attempt_number), 0) + 1
  into v_next_attempt
  from public.payment_attempts pa
  where pa.order_id = p_order_id;

  insert into public.payment_attempts (
    payment_id, order_id, attempt_number, provider,
    provider_order_id, amount_paise, currency, status,
    idempotency_key, metadata
  ) values (
    v_payment.id, p_order_id, v_next_attempt, 'razorpay',
    p_provider_order_id, p_amount_paise, p_currency, 'created',
    p_idempotency_key || ':attempt:' || v_next_attempt::text,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_attempt;

  return query select v_payment.id, v_attempt.id, v_attempt.attempt_number;
end;
$$;

revoke all on function public.register_razorpay_payment_attempt(uuid, uuid, text, bigint, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.register_razorpay_payment_attempt(uuid, uuid, text, bigint, text, text, timestamptz, jsonb) to service_role;

-- Exact-once atomic capture finalization invoked by verified callback OR verified webhook.
create or replace function public.finalize_online_payment_capture(
  p_order_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_signature_verified boolean,
  p_api_verified boolean,
  p_gateway_method text default null,
  p_gateway_fee_paise bigint default 0,
  p_verification_source text default 'verify_endpoint'
)
returns table (
  order_id uuid,
  payment_status text,
  order_status text,
  already_captured boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_settings public.marketplace_settings%rowtype;
  v_so record;
  v_comm_bps integer := 1200;
  v_entry_group uuid := uuid_generate_v4();
begin
  if nullif(trim(coalesce(p_provider_order_id, '')), '') is null
     or nullif(trim(coalesce(p_provider_payment_id, '')), '') is null then
    raise exception 'provider_order_id and provider_payment_id are required for capture finalization.';
  end if;

  if not (coalesce(p_signature_verified, false) or coalesce(p_api_verified, false)) then
    raise exception 'Refusing to finalize capture without server-side signature or API verification.';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found.', p_order_id;
  end if;

  if v_order.payment_method <> 'online' then
    raise exception 'Cannot finalize online capture for non-online order.';
  end if;

  if v_order.currency <> p_currency then
    raise exception 'Currency mismatch: expected %, received %.', v_order.currency, p_currency;
  end if;

  if v_order.total_paise <> p_amount_paise then
    raise exception 'Amount mismatch: expected % paise, received % paise.', v_order.total_paise, p_amount_paise;
  end if;

  -- Idempotency: if already paid with the same payment ID, enrich verification flags cleanly
  if v_order.payment_status in ('paid', 'captured', 'refund_pending', 'refunded', 'partially_refunded') then
    select * into v_payment
    from public.payments p
    where p.order_id = v_order.id and p.provider = 'razorpay'
    for update;

    if found and v_payment.provider_payment_id is not null and v_payment.provider_payment_id <> p_provider_payment_id then
      raise exception 'Duplicate payment conflict: order % already settled with payment %.', v_order.id, v_payment.provider_payment_id;
    end if;

    if found then
      update public.payments
      set
        signature_verified = signature_verified or coalesce(p_signature_verified, false),
        api_verified = api_verified or coalesce(p_api_verified, false),
        verified_at = coalesce(verified_at, now()),
        updated_at = now()
      where id = v_payment.id;
    end if;

    return query select v_order.id, v_order.payment_status, v_order.order_status, true;
    return;
  end if;

  -- Protect against fulfilling an order whose inventory reservation was already released
  if v_order.reservation_released_at is not null or v_order.order_status in ('expired', 'cancelled') then
    raise exception 'Cannot confirm capture on expired/cancelled order % whose inventory reservation was already released; manual refund/reconciliation required.', v_order.id;
  end if;

  select * into v_attempt
  from public.payment_attempts pa
  where pa.order_id = v_order.id
    and pa.provider_order_id = p_provider_order_id
  for update;

  if not found then
    raise exception 'Payment attempt matching Razorpay order % not found for order %.', p_provider_order_id, v_order.id;
  end if;

  select * into v_payment
  from public.payments p
  where p.id = v_attempt.payment_id
  for update;

  if not found then
    raise exception 'Payment record % not found.', v_attempt.payment_id;
  end if;

  update public.payment_attempts
  set
    provider_payment_id = p_provider_payment_id,
    status = 'captured',
    signature_verified = signature_verified or coalesce(p_signature_verified, false),
    api_verified = api_verified or coalesce(p_api_verified, false),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'gateway_method', p_gateway_method,
      'verification_source', p_verification_source
    )),
    updated_at = now()
  where id = v_attempt.id;

  update public.payments
  set
    provider_order_id = p_provider_order_id,
    provider_payment_id = p_provider_payment_id,
    captured_paise = p_amount_paise,
    status = 'captured',
    signature_verified = signature_verified or coalesce(p_signature_verified, false),
    api_verified = api_verified or coalesce(p_api_verified, false),
    verified_at = coalesce(verified_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'gateway_method', p_gateway_method,
      'verification_source', p_verification_source
    )),
    updated_at = now()
  where id = v_payment.id;

  update public.orders
  set
    payment_status = 'paid',
    order_status = case
      when order_status in ('pending', 'pending_payment') then 'confirmed'
      else order_status
    end,
    reservation_expires_at = null,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  select * into v_settings from public.marketplace_settings where id = 1;
  v_comm_bps := coalesce(v_settings.commission_basis_points, 1200);

  -- Append-only financial ledger postings guarded by partial unique indexes (exact-once)
  insert into public.financial_ledger_entries (
    entry_group_id, order_id, payment_id, entry_type, direction, amount_paise,
    commission_rate_bps, description, reference_id, created_by
  ) values (
    v_entry_group, v_order.id, v_payment.id, 'payment_captured', 'credit', p_amount_paise,
    v_comm_bps, 'Verified Razorpay online payment captured', p_provider_payment_id, v_order.customer_id
  )
  on conflict do nothing;

  if v_order.shipping_paise > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, payment_id, entry_type, direction, amount_paise,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_payment.id, 'shipping_allocation', 'credit', v_order.shipping_paise,
      'Customer shipping fee allocated to platform', v_order.order_number, v_order.customer_id
    )
    on conflict do nothing;
  end if;

  if coalesce(p_gateway_fee_paise, 0) > 0 then
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, payment_id, entry_type, direction, amount_paise,
      description, reference_id, created_by
    ) values (
      v_entry_group, v_order.id, v_payment.id, 'gateway_fee', 'debit', p_gateway_fee_paise,
      'Razorpay gateway fee recorded on capture', p_provider_payment_id, v_order.customer_id
    )
    on conflict do nothing;
  end if;

  for v_so in
    select *
    from public.seller_orders so
    where so.order_id = v_order.id
    order by so.seller_id asc
  loop
    insert into public.financial_ledger_entries (
      entry_group_id, order_id, seller_order_id, seller_id, payment_id,
      entry_type, direction, amount_paise, commission_rate_bps,
      description, reference_id, created_by
    ) values
      (
        v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_payment.id,
        'order_charge', 'debit', v_so.subtotal_paise, v_comm_bps,
        'Online seller product subtotal allocation', v_order.order_number, v_order.customer_id
      ),
      (
        v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_payment.id,
        'commission_accrual', 'credit', v_so.commission_amount_paise, v_comm_bps,
        'Platform 12% commission accrued on product subtotal', v_order.order_number, v_order.customer_id
      ),
      (
        v_entry_group, v_order.id, v_so.id, v_so.seller_id, v_payment.id,
        'seller_payable_credit', 'credit', v_so.seller_payable_paise, v_comm_bps,
        'Seller net share payable from captured online payment', v_order.order_number, v_order.customer_id
      )
    on conflict do nothing;
  end loop;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (
    v_order.id,
    v_order.order_status,
    'Online payment captured & verified (' || p_verification_source || ': ' || p_provider_payment_id || ')',
    v_order.customer_id
  );

  return query select v_order.id, v_order.payment_status, v_order.order_status, false;
end;
$$;

revoke all on function public.finalize_online_payment_capture(uuid, text, text, bigint, text, boolean, boolean, text, bigint, text) from public, anon, authenticated;
grant execute on function public.finalize_online_payment_capture(uuid, text, text, bigint, text, boolean, boolean, text, bigint, text) to service_role;

-- Records non-capture intermediate/failure states ('authorized', 'failed') safely with out-of-order protection.
create or replace function public.record_online_payment_state(
  p_order_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_next_status text,
  p_failure_code text default null,
  p_failure_reason text default null,
  p_signature_verified boolean default false,
  p_api_verified boolean default false
)
returns table (
  order_id uuid,
  payment_status text,
  order_status text,
  ignored_out_of_order boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_payment public.payments%rowtype;
begin
  if p_next_status not in ('authorized', 'failed') then
    raise exception 'Unsupported non-capture state %.', p_next_status;
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found.', p_order_id;
  end if;

  select * into v_attempt
  from public.payment_attempts pa
  where pa.order_id = v_order.id
    and pa.provider_order_id = p_provider_order_id
  for update;

  if not found then
    raise exception 'Payment attempt matching Razorpay order % not found.', p_provider_order_id;
  end if;

  select * into v_payment
  from public.payments p
  where p.id = v_attempt.payment_id
  for update;

  -- Never downgrade an already captured/paid order or captured attempt (out-of-order webhook safety)
  if v_attempt.status = 'captured'
     or v_order.payment_status in ('paid', 'captured', 'refund_pending', 'refunded', 'partially_refunded') then
    return query select v_order.id, v_order.payment_status, v_order.order_status, true;
    return;
  end if;

  if v_attempt.status = 'authorized' and p_next_status = 'failed' then
    return query select v_order.id, v_order.payment_status, v_order.order_status, true;
    return;
  end if;

  update public.payment_attempts
  set
    provider_payment_id = coalesce(nullif(p_provider_payment_id, ''), provider_payment_id),
    status = p_next_status,
    failure_code = coalesce(p_failure_code, failure_code),
    failure_reason = coalesce(p_failure_reason, failure_reason),
    signature_verified = signature_verified or coalesce(p_signature_verified, false),
    api_verified = api_verified or coalesce(p_api_verified, false),
    updated_at = now()
  where id = v_attempt.id;

  -- Only update parent payment/order if this attempt is the currently active provider_order_id
  if v_payment.provider_order_id = p_provider_order_id and v_payment.status <> 'captured' then
    update public.payments
    set
      provider_payment_id = coalesce(nullif(p_provider_payment_id, ''), provider_payment_id),
      status = p_next_status,
      signature_verified = signature_verified or coalesce(p_signature_verified, false),
      api_verified = api_verified or coalesce(p_api_verified, false),
      updated_at = now()
    where id = v_payment.id;

    -- For 'authorized', bound the inventory hold window (up to 45 mins from order creation)
    -- so capture can still complete asynchronously without holding inventory indefinitely.
    update public.orders
    set
      payment_status = p_next_status,
      reservation_expires_at = case
        when p_next_status = 'authorized' then least(
          created_at + interval '45 minutes',
          greatest(coalesce(reservation_expires_at, now()), now() + interval '15 minutes')
        )
        else reservation_expires_at
      end,
      updated_at = now()
    where id = v_order.id
      and order_status = 'pending_payment'
      and payment_status not in ('paid', 'captured', 'refunded', 'partially_refunded')
    returning * into v_order;
  end if;

  return query select v_order.id, v_order.payment_status, v_order.order_status, false;
end;
$$;

revoke all on function public.record_online_payment_state(uuid, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_online_payment_state(uuid, text, text, text, text, text, boolean, boolean) to service_role;

-- Update release_expired_online_order_inventory from 008 so expired bounded 'authorized' holds
-- (abandoned uncaptured authorizations past reservation_expires_at) can also be safely released
-- once the Edge Function has confirmed with Razorpay that the payment was NOT captured.
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
      and o.payment_status in ('created', 'pending', 'failed', 'authorized')
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
      status = case when status in ('created', 'pending', 'authorized') then v_next_payment_status else status end,
      updated_at = now()
    where order_id = v_order.id and status in ('created', 'pending', 'authorized');

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

-- Prevents a delayed capture webhook after reservation expiry from creating a confirmed order
-- without reserved inventory. Preserves expired/restored stock and flags payment for refund.
create or replace function public.record_late_capture_after_expiry(
  p_order_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_signature_verified boolean,
  p_api_verified boolean
)
returns table (
  order_id uuid,
  payment_status text,
  order_status text,
  requires_refund boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found.', p_order_id;
  end if;

  if v_order.currency <> p_currency or v_order.total_paise <> p_amount_paise then
    raise exception 'Late capture amount/currency mismatch.';
  end if;

  select * into v_attempt
  from public.payment_attempts pa
  where pa.order_id = v_order.id
    and pa.provider_order_id = p_provider_order_id
  for update;

  if found then
    update public.payment_attempts
    set
      provider_payment_id = p_provider_payment_id,
      status = 'captured',
      signature_verified = signature_verified or coalesce(p_signature_verified, false),
      api_verified = api_verified or coalesce(p_api_verified, false),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'late_capture_after_expiry', true
      ),
      updated_at = now()
    where id = v_attempt.id;
  end if;

  select * into v_payment
  from public.payments p
  where p.order_id = v_order.id and p.provider = 'razorpay'
  for update;

  if found then
    update public.payments
    set
      provider_order_id = p_provider_order_id,
      provider_payment_id = p_provider_payment_id,
      captured_paise = p_amount_paise,
      status = 'refund_pending',
      signature_verified = signature_verified or coalesce(p_signature_verified, false),
      api_verified = api_verified or coalesce(p_api_verified, false),
      verified_at = coalesce(verified_at, now()),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'late_capture_after_expiry', true,
        'requires_manual_refund', true
      ),
      updated_at = now()
    where id = v_payment.id;
  end if;

  -- Never restore confirmation or emit seller payable ledger entries without stock.
  -- Keep order expired/cancelled and flag payment_status = 'refund_pending'.
  update public.orders
  set
    payment_status = 'refund_pending',
    cancellation_reason = coalesce(
      cancellation_reason,
      'Late Razorpay capture arrived after inventory reservation expired; refund required.'
    ),
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.order_status_history (order_id, status, note)
  values (
    v_order.id,
    v_order.order_status,
    'Late capture detected after reservation expiry (' || p_provider_payment_id || ') — flagged refund_pending without fulfilling unreserved stock'
  );

  return query select v_order.id, v_order.payment_status, v_order.order_status, true;
end;
$$;

revoke all on function public.record_late_capture_after_expiry(uuid, text, text, bigint, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_late_capture_after_expiry(uuid, text, text, bigint, text, boolean, boolean) to service_role;

commit;
