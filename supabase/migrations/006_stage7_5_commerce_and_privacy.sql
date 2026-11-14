-- NOHAJ Marketplace — Stage 7.5: Public Seller Directory, Order Cancellation & Schema Standardization
-- Migration: 006_stage7_5_commerce_and_privacy.sql
-- Depends on: 001_initial_schema.sql through 005_security_and_schema_hardening.sql.
-- Safe to rerun: Yes (transaction-wrapped and idempotent).

begin;

-- ============================================================================
-- 1. PROTECT SELLER CONTACT PII VIA SAFE PUBLIC DIRECTORY VIEW
-- ============================================================================

-- Restrict direct SELECT on seller_profiles to the owning seller or admins
drop policy if exists "Public read active seller profiles" on public.seller_profiles;
drop policy if exists "Owners and admins read seller profiles" on public.seller_profiles;
create policy "Owners and admins read seller profiles"
  on public.seller_profiles for select
  using (
    user_id = auth.uid()
    or public.is_admin(auth.uid())
  );

-- Public read-only directory exposing ONLY approved non-PII public store metadata
create or replace view public.public_seller_directory as
select
  sp.id,
  sp.business_name,
  sp.slug,
  sp.owner_name,
  sp.location,
  sp.state,
  sp.district,
  sp.seller_type,
  sp.categories,
  sp.bio,
  sp.logo_url,
  sp.banner_url,
  sp.social_link,
  (sp.payout_verification_status = 'verified') as is_payout_verified,
  sp.created_at
from public.seller_profiles sp
where sp.account_status = 'active';

revoke all on public.public_seller_directory from public;
grant select on public.public_seller_directory to anon, authenticated;

-- ============================================================================
-- 2. SCHEMA & ROLE STANDARDIZATION (TASK 6)
-- ============================================================================

-- Add missing product discovery columns required by storefront filters
alter table public.products
  add column if not exists occasion text[] not null default '{}',
  add column if not exists is_featured boolean not null default false;

create index if not exists idx_products_featured on public.products (is_featured) where is_featured = true;

-- Standardize production_method values across SQL & frontend
update public.products
set production_method = case lower(trim(production_method))
  when 'handwoven' then 'Handwoven'
  when 'traditional loom' then 'Traditional Loom'
  when 'artisan-crafted' then 'Artisan-Crafted'
  when 'handmade' then 'Handmade'
  when 'powerloom' then 'Powerloom'
  when 'machine-made' then 'Powerloom'
  when 'sourced' then 'Sourced'
  else 'Handwoven'
end
where production_method is distinct from case lower(trim(production_method))
  when 'handwoven' then 'Handwoven'
  when 'traditional loom' then 'Traditional Loom'
  when 'artisan-crafted' then 'Artisan-Crafted'
  when 'handmade' then 'Handmade'
  when 'powerloom' then 'Powerloom'
  when 'machine-made' then 'Powerloom'
  when 'sourced' then 'Sourced'
  else 'Handwoven'
end;

alter table public.products drop constraint if exists products_production_method_check;
alter table public.products
  add constraint products_production_method_check
  check (production_method in (
    'Handwoven', 'Traditional Loom', 'Artisan-Crafted', 'Handmade', 'Powerloom', 'Sourced'
  ));

-- Migrate any legacy 'admin' user_roles rows to 'super_admin' and align constraint with TypeScript UserRole
insert into public.user_roles (user_id, role)
select user_id, 'super_admin'
from public.user_roles
where role = 'admin'
on conflict (user_id, role) do nothing;

delete from public.user_roles where role = 'admin';

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('customer', 'seller', 'super_admin', 'operations_admin', 'content_admin'));

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = 'super_admin'
  );
$$;

create or replace function public.is_operations_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('super_admin', 'operations_admin')
  );
$$;

create or replace function public.is_content_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('super_admin', 'content_admin')
  );
$$;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('super_admin', 'operations_admin', 'content_admin')
  );
$$;

-- ============================================================================
-- 3. ORDER CANCELLATION, EXACT-ONCE INVENTORY RESTORATION & COD RECONCILIATION
-- ============================================================================

alter table public.order_items
  add column if not exists inventory_restored boolean not null default false;

alter table public.orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancellation_reason text;

alter table public.seller_orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancellation_reason text;

-- Prevent direct table updates to fulfilment_status = 'cancelled' that bypass inventory restoration
create or replace function public.guard_seller_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_status = 'cancelled' and old.fulfilment_status <> 'cancelled' then
    if exists (
      select 1 from public.order_items oi
      where oi.seller_order_id = new.id and oi.inventory_restored = false
    ) then
      raise exception 'Orders must be cancelled through cancel_seller_order() or cancel_customer_order() so inventory is restored.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_guard_seller_order_cancellation on public.seller_orders;
create trigger on_guard_seller_order_cancellation
  before update on public.seller_orders
  for each row execute procedure public.guard_seller_order_cancellation();

-- Recompute parent order status when one or more seller_orders change
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
    v_next_payment_status := case
      when v_order.payment_method = 'cod' and v_order.payment_status = 'cod_pending' then 'cancelled'
      when v_order.payment_status = 'paid' then 'refunded'
      else v_order.payment_status
    end;
  elsif v_cancelled_so > 0 then
    v_next_status := 'partially_cancelled';
    v_next_payment_status := case
      when v_order.payment_status = 'paid' then 'partially_refunded'
      else v_order.payment_status
    end;
  elsif v_delivered_so = v_total_so then
    v_next_status := 'delivered';
    v_next_payment_status := v_order.payment_status;
  elsif v_dispatched_so = v_total_so then
    v_next_status := 'dispatched';
    v_next_payment_status := v_order.payment_status;
  elsif v_dispatched_so > 0 then
    v_next_status := 'partially_dispatched';
    v_next_payment_status := v_order.payment_status;
  else
    v_next_status := v_order.order_status;
    v_next_payment_status := v_order.payment_status;
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

-- Internal exact-once restoration helper for one seller_order
create or replace function public.internal_restore_seller_order_inventory(p_seller_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  for v_item in
    select * from public.order_items
    where seller_order_id = p_seller_order_id and inventory_restored = false
    order by id
    for update
  loop
    if v_item.variant_id is not null then
      update public.product_variants
      set stock_quantity = stock_quantity + v_item.quantity
      where id = v_item.variant_id;
    else
      update public.products
      set
        stock_quantity = stock_quantity + v_item.quantity,
        availability = case
          when availability = 'Out of Stock' and (stock_quantity + v_item.quantity) > 0 then 'In Stock'
          else availability
        end
      where id = v_item.product_id;
    end if;

    update public.order_items
    set inventory_restored = true
    where id = v_item.id;
  end loop;
end;
$$;

revoke all on function public.internal_restore_seller_order_inventory(uuid) from public, anon, authenticated;

-- Cancel a single seller_order (callable by owning seller before dispatch, or operations/super admin)
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

  if not v_is_ops_admin and v_so.fulfilment_status in ('shipped', 'dispatched', 'delivered') then
    raise exception 'Dispatched or delivered seller orders cannot be cancelled directly.';
  end if;

  if v_is_ops_admin and v_so.fulfilment_status = 'delivered' then
    raise exception 'Delivered orders must use the returns workflow.';
  end if;

  -- Restore stock atomically BEFORE marking seller_order cancelled
  perform public.internal_restore_seller_order_inventory(v_so.id);

  update public.seller_orders
  set
    fulfilment_status = 'cancelled',
    cod_reconciliation_status = case
      when cod_reconciliation_status = 'awaiting_collection' then 'not_applicable'
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

revoke all on function public.cancel_seller_order(uuid, text) from public, anon;
grant execute on function public.cancel_seller_order(uuid, text) to authenticated;

-- Cancel an entire customer parent order (callable by customer before packing/dispatch, or operations/super admin)
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
      where order_id = v_order.id and fulfilment_status = 'delivered'
    ) then
      raise exception 'Delivered orders must use the returns workflow.';
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
        when cod_reconciliation_status = 'awaiting_collection' then 'not_applicable'
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

revoke all on function public.cancel_customer_order(uuid, text) from public, anon;
grant execute on function public.cancel_customer_order(uuid, text) to authenticated;

commit;
