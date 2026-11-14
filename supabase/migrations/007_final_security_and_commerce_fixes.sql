-- NOHAJ Marketplace — Stage 7.7: Final Security Remediation & Commerce Fixes
-- Migration: 007_final_security_and_commerce_fixes.sql
-- Depends on: 001_initial_schema.sql through 006_stage7_5_commerce_and_privacy.sql.
-- Safe to rerun: Yes (forward-only, transaction-wrapped, precondition-checked, idempotent).

begin;

-- ============================================================================
-- 0. PRECONDITION CHECKS (FAIL FAST IF PRIOR MIGRATIONS WERE NOT APPLIED)
-- ============================================================================

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.user_roles') is null
     or to_regclass('public.seller_profiles') is null
     or to_regclass('public.products') is null
     or to_regclass('public.product_variants') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.seller_orders') is null
     or to_regclass('public.order_items') is null
     or to_regclass('public.marketplace_settings') is null then
    raise exception 'Precondition failed: migrations 001 through 006 must be applied before 007_final_security_and_commerce_fixes.sql.';
  end if;
end $$;

-- ============================================================================
-- 1. TRUSTED SQL MAINTENANCE AUTHORIZATION (TASK 3)
-- ============================================================================
-- Semantics:
--   - current_user inside a SECURITY DEFINER function becomes the function owner
--     (e.g. postgres), so checking current_user does NOT identify the caller.
--   - session_user remains the database connection user (e.g. 'authenticator'
--     for PostgREST HTTP traffic, 'supabase_auth_admin' for Auth triggers, or
--     'postgres' / 'supabase_admin' in privileged SQL Editor / CLI sessions).
--   - PostgREST always populates request.jwt.claim.role ('anon' / 'authenticated'
--     / 'service_role') and cannot spoof session_user.
-- This helper MUST remain SECURITY INVOKER so auth.uid() and session_user are
-- evaluated in the caller's actual context, never via a user-controlled GUC or
-- a broad auth.uid() IS NULL bypass.

create or replace function public.is_trusted_sql_maintenance()
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(current_setting('request.jwt.claim.role', true), '') = ''
    and auth.uid() is null
    and session_user in ('postgres', 'supabase_admin');
$$;

revoke all on function public.is_trusted_sql_maintenance() from public;
grant execute on function public.is_trusted_sql_maintenance() to authenticated;

-- ============================================================================
-- 2. STRICT ROLE SEPARATION FOR CONTENT ADMIN vs OPERATIONS ADMIN (TASK 1)
-- ============================================================================

-- PROFILES: owner or operations_admin / super_admin only (never content_admin)
drop policy if exists "Users view own profile" on public.profiles;
create policy "Users view own profile"
  on public.profiles for select
  using (
    auth.uid() = id
    or public.is_operations_admin(auth.uid())
  );

-- USER ROLES: owner or super_admin only (every user can always read own roles)
drop policy if exists "Users view own roles" on public.user_roles;
create policy "Users view own roles"
  on public.user_roles for select
  using (
    auth.uid() = user_id
    or public.is_super_admin(auth.uid())
  );

-- SELLER PROFILES: owner or operations_admin / super_admin only (never content_admin)
drop policy if exists "Owners and admins read seller profiles" on public.seller_profiles;
create policy "Owners and admins read seller profiles"
  on public.seller_profiles for select
  using (
    user_id = auth.uid()
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Users update own seller profile" on public.seller_profiles;
create policy "Users update own seller profile"
  on public.seller_profiles for update
  using (
    user_id = auth.uid()
    or public.is_operations_admin(auth.uid())
  )
  with check (
    user_id = auth.uid()
    or public.is_operations_admin(auth.uid())
  );

-- ORDERS: customer owner or operations_admin / super_admin only (never content_admin)
drop policy if exists "Customers view own orders" on public.orders;
create policy "Customers view own orders"
  on public.orders for select
  using (
    auth.uid() = customer_id
    or public.is_operations_admin(auth.uid())
  );

-- SELLER ORDERS: owning seller or operations_admin / super_admin only (never content_admin)
drop policy if exists "Sellers view own seller_orders" on public.seller_orders;
create policy "Sellers view own seller_orders"
  on public.seller_orders for select
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Sellers update own seller_orders" on public.seller_orders;
create policy "Sellers update own seller_orders"
  on public.seller_orders for update
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

-- SHIPMENTS: allow owning seller and operations_admin to update tracking details too
drop policy if exists "Sellers update own shipments" on public.shipments;
create policy "Sellers update own shipments"
  on public.shipments for update
  using (
    exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  )
  with check (
    exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- PAYMENTS: customer owner or operations_admin / super_admin only (never content_admin)
drop policy if exists "Customers view own payments" on public.payments;
create policy "Customers view own payments"
  on public.payments for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- SELLER APPLICATIONS: operations_admin / super_admin only (never content_admin)
drop policy if exists "Admins view seller applications" on public.seller_applications;
create policy "Admins view seller applications"
  on public.seller_applications for select
  using (public.is_operations_admin(auth.uid()));

drop policy if exists "Operations admins update seller applications" on public.seller_applications;
create policy "Operations admins update seller applications"
  on public.seller_applications for update
  using (public.is_operations_admin(auth.uid()))
  with check (public.is_operations_admin(auth.uid()));

-- AUDIT LOGS:
-- - SELECT restricted to super_admin only so content_admin cannot read private operational audit trails.
-- - INSERT allowed for super_admin, operations_admin (operational tables), and content_admin (content/moderation tables),
--   always bound to actor_id = auth.uid().
drop policy if exists "Admins only view audit logs" on public.audit_logs;
create policy "Admins only view audit logs"
  on public.audit_logs for select
  using (public.is_super_admin(auth.uid()));

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
          'shipments', 'returns', 'seller_applications'
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

-- Narrow moderation helper so Content Admin can display seller store name & account status
-- on moderation cards without ANY access to seller contact PII, payout status, or KYC data.
create or replace function public.get_moderation_seller_summary()
returns table (
  id uuid,
  business_name text,
  account_status text
)
language sql
security definer
stable
set search_path = public
as $$
  select sp.id, sp.business_name, sp.account_status
  from public.seller_profiles sp
  where public.is_admin(auth.uid());
$$;

revoke all on function public.get_moderation_seller_summary() from public, anon;
grant execute on function public.get_moderation_seller_summary() to authenticated;

-- ============================================================================
-- 3. SAFE PUBLIC SELLER DIRECTORY (TASK 8)
-- ============================================================================
-- Recreate public_seller_directory as a security_invoker = true view backed by a
-- narrowly scoped SECURITY DEFINER SQL function with fixed search_path.
-- Benefits:
--   - public.seller_profiles RLS remains completely closed to anon/customers.
--   - public_seller_directory executes with security_invoker = true (eliminates
--     security_definer_view linter warning on the view while preserving anon/auth
--     storefront discovery of active sellers' non-PII columns only).

create or replace function public.get_public_seller_directory()
returns table (
  id uuid,
  business_name text,
  slug text,
  owner_name text,
  location text,
  state text,
  district text,
  seller_type text,
  categories text[],
  bio text,
  logo_url text,
  banner_url text,
  social_link text,
  is_payout_verified boolean,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
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
$$;

revoke all on function public.get_public_seller_directory() from public;
grant execute on function public.get_public_seller_directory() to anon, authenticated;

drop view if exists public.public_seller_directory;
create view public.public_seller_directory
with (security_invoker = true) as
select * from public.get_public_seller_directory();

revoke all on public.public_seller_directory from public;
grant select on public.public_seller_directory to anon, authenticated;

-- ============================================================================
-- 4. PROTECT products.is_featured, HARDEN GUARD TRIGGERS & HIDE SUSPENDED SELLERS'
--    PRODUCTS (TASKS 2, 3, 4)
-- ============================================================================

-- Restrict product UPDATE policy to owning seller or content_admin / super_admin
drop policy if exists "Sellers update own products" on public.products;
create policy "Sellers update own products"
  on public.products for update
  using (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_content_admin(auth.uid())
  )
  with check (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_content_admin(auth.uid())
  );

-- Public users see ONLY approved + published products belonging to ACTIVE sellers
drop policy if exists "Public read approved published products" on public.products;
create policy "Public read approved published products"
  on public.products for select
  using (
    (
      approval_status = 'approved'
      and is_published = true
      and exists (
        select 1 from public.seller_profiles sp
        where sp.id = seller_id and sp.account_status = 'active'
      )
    )
    or exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id and sp.user_id = auth.uid()
    )
    or public.is_admin(auth.uid())
  );

-- Align product_images & product_variants public visibility with active seller status
drop policy if exists "Public read product images of published products" on public.product_images;
create policy "Public read product images of published products"
  on public.product_images for select
  using (
    exists (
      select 1 from public.products p
      join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_id
        and (
          (p.approval_status = 'approved' and p.is_published = true and sp.account_status = 'active')
          or sp.user_id = auth.uid()
          or public.is_admin(auth.uid())
        )
    )
  );

drop policy if exists "Public read variants of published products" on public.product_variants;
create policy "Public read variants of published products"
  on public.product_variants for select
  using (
    exists (
      select 1 from public.products p
      join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_id
        and (
          (p.approval_status = 'approved' and p.is_published = true and sp.account_status = 'active')
          or sp.user_id = auth.uid()
          or public.is_admin(auth.uid())
        )
    )
  );

-- Guard product moderation & is_featured columns on INSERT and UPDATE
create or replace function public.guard_product_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_status text;
  v_can_moderate boolean := (
    public.is_content_admin(auth.uid())
    or public.is_trusted_sql_maintenance()
  );
begin
  if not v_can_moderate then
    if new.approval_status in ('approved', 'suspended')
       or new.is_published = true
       or new.is_featured = true then
      if tg_op = 'INSERT' then
        raise exception 'Only authorized NOHAJ administrators can approve, publish, suspend, or feature products.';
      end if;
    end if;

    if tg_op = 'UPDATE' then
      if new.approval_status is distinct from old.approval_status
         and new.approval_status in ('approved', 'suspended') then
        raise exception 'Only authorized NOHAJ administrators can approve, publish, or suspend products.';
      end if;

      if new.is_published is distinct from old.is_published
         and new.is_published = true then
        raise exception 'Only authorized NOHAJ administrators can approve, publish, or suspend products.';
      end if;

      if new.is_featured is distinct from old.is_featured then
        raise exception 'Only authorized NOHAJ administrators can feature or unfeature products.';
      end if;

      if (
        old.name is distinct from new.name or
        old.material is distinct from new.material or
        old.production_method is distinct from new.production_method or
        old.community_id is distinct from new.community_id or
        old.price is distinct from new.price
      ) and old.approval_status = 'approved' then
        new.approval_status := 'pending_review';
        new.is_published := false;
      end if;
    end if;
  else
    -- Even content_admin / maintenance cannot approve or publish a product of a non-active seller
    if new.approval_status = 'approved' or new.is_published = true then
      select account_status into v_seller_status
      from public.seller_profiles where id = new.seller_id;
      if v_seller_status is distinct from 'active' then
        raise exception 'Cannot approve or publish products for a seller whose account is not active.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Unpublish & require re-moderation whenever an active seller leaves 'active' status.
-- Ensures products never auto-republish if the seller is later reactivated.
create or replace function public.handle_seller_status_product_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.account_status = 'active' and new.account_status <> 'active' then
    update public.products
    set
      approval_status = case
        when approval_status = 'approved' then 'pending_review'
        else approval_status
      end,
      is_published = false,
      updated_at = now()
    where seller_id = new.id
      and (is_published = true or approval_status = 'approved');
  end if;
  return new;
end;
$$;

drop trigger if exists on_seller_status_hide_products on public.seller_profiles;
create trigger on_seller_status_hide_products
  after update of account_status on public.seller_profiles
  for each row execute procedure public.handle_seller_status_product_visibility();

-- Harden guard_seller_profile_status: replace current_user illusion with session_user + is_trusted_sql_maintenance()
create or replace function public.guard_seller_profile_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_is_internal_auth_sync boolean := (
    v_jwt_role = ''
    and auth.uid() is null
    and session_user in ('supabase_auth_admin', 'postgres', 'supabase_admin')
    and old.email_verified = false
    and new.email_verified = true
    and new.email_verified_at is not null
    and new.payout_verification_status is not distinct from old.payout_verification_status
    and (
      new.account_status is not distinct from old.account_status
      or (old.account_status = 'pending_email_verification' and new.account_status = 'pending_approval')
    )
  );
  v_can_administer boolean := (
    public.is_operations_admin(auth.uid())
    or public.is_trusted_sql_maintenance()
  );
begin
  if not v_can_administer and not v_is_internal_auth_sync then
    if new.account_status is distinct from old.account_status
       or new.payout_verification_status is distinct from old.payout_verification_status
       or new.email_verified is distinct from old.email_verified
       or new.email_verified_at is distinct from old.email_verified_at then
      raise exception 'Only authorized administrators can change seller account, email verification, or payout verification status.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Harden guard_seller_order_financials: include is_trusted_sql_maintenance() instead of relying on auth.uid() IS NULL
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
  );
begin
  if not v_can_administer then
    if new.subtotal is distinct from old.subtotal
       or new.commission_rate_snapshot is distinct from old.commission_rate_snapshot
       or new.commission_amount is distinct from old.commission_amount
       or new.seller_payout_amount is distinct from old.seller_payout_amount then
      raise exception 'Only authorized administrators can alter seller order financial totals.';
    end if;

    if new.cod_reconciliation_status is distinct from old.cod_reconciliation_status then
      if not (
        new.fulfilment_status = 'cancelled'
        and old.fulfilment_status <> 'cancelled'
        and old.cod_reconciliation_status = 'awaiting_collection'
        and new.cod_reconciliation_status = 'not_applicable'
      ) then
        raise exception 'Only authorized administrators can alter COD reconciliation status.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- 5. CHECKOUT: DISABLE ONLINE PAYMENTS, AGGREGATE DUPLICATES & SORT LOCKS (TASKS 5 & 6)
-- ============================================================================

alter table public.product_variants drop constraint if exists product_variants_price_override_check;
alter table public.product_variants
  add constraint product_variants_price_override_check
  check (price_override is null or price_override >= 0);

create or replace function public.create_multi_vendor_order(
  p_shipping_address jsonb,
  p_payment_method text,
  p_items jsonb -- array of { product_id, variant_id (optional), quantity }
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
  v_subtotal numeric(10, 2) := 0;
  v_shipping numeric(10, 2) := 0;
  v_total numeric(10, 2) := 0;
  v_item record;
  v_raw_item jsonb;
  v_product record;
  v_variant record;
  v_seller record;
  v_settings record;
  v_seller_group record;
  v_seller_order_id uuid;
  v_unit_price numeric(10, 2);
  v_qty integer;
  v_line_total numeric(10, 2);
  v_has_variants boolean;
  v_commission numeric(10, 2);
  v_payout numeric(10, 2);
begin
  if v_customer_id is null then
    raise exception 'Authentication required to place an order.';
  end if;

  if p_payment_method = 'online' then
    raise exception 'Online payment is currently disabled until a verified payment gateway is configured. Please select Cash on Delivery.';
  end if;

  if p_payment_method <> 'cod' then
    raise exception 'Invalid payment method.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

  -- Validate every raw element up front before aggregation
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

  if p_payment_method = 'cod' and not v_settings.cod_enabled then
    raise exception 'Cash on Delivery is currently disabled.';
  end if;

  create temp table if not exists _mv_order_lines (
    seller_id uuid not null,
    product_id uuid not null,
    variant_id uuid,
    product_name text not null,
    quantity integer not null,
    unit_price numeric(10, 2) not null,
    line_total numeric(10, 2) not null
  ) on commit drop;
  truncate table _mv_order_lines;

  -- PASS 1: Aggregate identical (product_id, variant_id) pairs and acquire locks
  -- in deterministic (product_id ASC, variant_id ASC NULLS FIRST) order to prevent deadlocks.
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

      v_unit_price := coalesce(v_variant.price_override, v_product.price);
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

      v_unit_price := v_product.price;
    end if;

    v_line_total := round(v_unit_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;

    insert into _mv_order_lines (
      seller_id, product_id, variant_id, product_name, quantity, unit_price, line_total
    ) values (
      v_product.seller_id, v_product.id, v_item.variant_id, v_product.name, v_qty, v_unit_price, v_line_total
    );
  end loop;

  v_shipping := case when v_subtotal >= v_settings.free_shipping_threshold then 0 else v_settings.flat_shipping_fee end;
  v_total := v_subtotal + v_shipping;
  v_order_number := 'NHJ-' || floor(100000 + random() * 900000)::text;

  -- PASS 2: Insert parent order with exact server-computed totals
  insert into public.orders (
    order_number, customer_id, shipping_address,
    subtotal, shipping_amount, total_amount,
    payment_method, payment_status, order_status
  ) values (
    v_order_number, v_customer_id, p_shipping_address,
    v_subtotal, v_shipping, v_total,
    'cod', 'cod_pending', 'confirmed'
  )
  returning id into v_order_id;

  -- PASS 3: Insert each seller_order ONCE with final subtotal, commission snapshot, and payout
  for v_seller_group in
    select seller_id, sum(line_total) as seller_subtotal
    from _mv_order_lines
    group by seller_id
    order by seller_id
  loop
    v_commission := round(v_seller_group.seller_subtotal * v_settings.commission_rate, 2);
    v_payout := v_seller_group.seller_subtotal - v_commission;

    insert into public.seller_orders (
      order_id, seller_id, subtotal, commission_rate_snapshot,
      commission_amount, seller_payout_amount,
      fulfilment_status, cod_reconciliation_status
    ) values (
      v_order_id, v_seller_group.seller_id, v_seller_group.seller_subtotal,
      v_settings.commission_rate, v_commission, v_payout,
      'pending', 'awaiting_collection'
    )
    returning id into v_seller_order_id;

    insert into public.order_items (
      order_id, seller_order_id, product_id, variant_id,
      product_name, quantity, unit_price
    )
    select
      v_order_id, v_seller_order_id, product_id, variant_id,
      product_name, quantity, unit_price
    from _mv_order_lines
    where seller_id = v_seller_group.seller_id
    order by product_id asc, variant_id asc nulls first;
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

-- ============================================================================
-- 6. CANCELLATION, COD PROTECTION, PARENT ORDER SYNC & REFUND HONESTY (TASK 7)
-- ============================================================================

-- Include 'refund_pending' in orders.payment_status so paid cancelled orders never fabricate 'refunded'
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in (
    'pending', 'paid', 'failed', 'refund_pending', 'refunded', 'partially_refunded',
    'cod_pending', 'cod_collected', 'cancelled'
  ));

-- Require inventory restoration for pre-dispatch cancellations; never allow silent pre-dispatch cancel without restoration.
create or replace function public.guard_seller_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_status = 'cancelled' and old.fulfilment_status <> 'cancelled' then
    if old.fulfilment_status not in ('shipped', 'dispatched', 'delivered') then
      if exists (
        select 1 from public.order_items oi
        where oi.seller_order_id = new.id and oi.inventory_restored = false
      ) then
        raise exception 'Orders must be cancelled through cancel_seller_order() or cancel_customer_order() so inventory is restored.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Recompute parent order status across normal fulfilment updates AND cancellations.
-- Never fabricate 'refunded' or 'partially_refunded' without an actual 'refunded' payments row.
create or replace function public.recompute_parent_order_status(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_so integer;
  v_cancelled_so integer;
  v_active_so integer;
  v_delivered_so integer;
  v_dispatched_so integer;
  v_processing_so integer;
  v_has_refund_record boolean := false;
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
    count(*) filter (where fulfilment_status in ('shipped', 'dispatched', 'delivered')),
    count(*) filter (where fulfilment_status in ('accepted', 'processing', 'packed', 'ready_to_dispatch'))
  into v_total_so, v_cancelled_so, v_delivered_so, v_dispatched_so, v_processing_so
  from public.seller_orders
  where order_id = p_order_id;

  if v_total_so = 0 then return; end if;
  v_active_so := v_total_so - v_cancelled_so;

  select exists (
    select 1 from public.payments
    where order_id = p_order_id and status = 'refunded'
  ) into v_has_refund_record;

  if v_cancelled_so = v_total_so then
    v_next_status := 'cancelled';
    v_next_payment_status := case
      when v_order.payment_method = 'cod' and v_order.payment_status = 'cod_pending' then 'cancelled'
      when v_order.payment_status in ('paid', 'refund_pending') and v_has_refund_record then 'refunded'
      when v_order.payment_status = 'paid' then 'refund_pending'
      else v_order.payment_status
    end;
  elsif v_cancelled_so > 0 then
    if v_delivered_so = v_active_so then
      v_next_status := 'partially_fulfilled';
    elsif v_dispatched_so = v_active_so or v_dispatched_so > 0 then
      v_next_status := 'partially_dispatched';
    else
      v_next_status := 'partially_cancelled';
    end if;

    v_next_payment_status := case
      when v_order.payment_status in ('paid', 'refund_pending') and v_has_refund_record then 'partially_refunded'
      when v_order.payment_status = 'paid' then 'refund_pending'
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
  elsif v_processing_so > 0 and v_order.order_status in ('confirmed', 'pending') then
    v_next_status := 'processing';
    v_next_payment_status := v_order.payment_status;
  else
    v_next_status := v_order.order_status;
    v_next_payment_status := v_order.payment_status;
  end if;

  if v_order.order_status is distinct from v_next_status
     or v_order.payment_status is distinct from v_next_payment_status
     or (v_next_status = 'cancelled' and v_order.cancelled_at is null) then
    update public.orders
    set
      order_status = v_next_status,
      payment_status = v_next_payment_status,
      cancelled_at = case when v_next_status = 'cancelled' and cancelled_at is null then now() else cancelled_at end,
      updated_at = now()
    where id = p_order_id;
  end if;
end;
$$;

revoke all on function public.recompute_parent_order_status(uuid) from public, anon, authenticated;

-- Sync parent order_status automatically on seller fulfilment status transitions
create or replace function public.handle_seller_order_status_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_status is distinct from old.fulfilment_status then
    perform public.recompute_parent_order_status(new.order_id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_sync_parent_order_status on public.seller_orders;
create trigger on_sync_parent_order_status
  after update of fulfilment_status on public.seller_orders
  for each row execute procedure public.handle_seller_order_status_sync();

-- Seller cancellation:
--   - Consistent lock order: parent orders -> seller_orders -> order_items (matches cancel_customer_order)
--   - Blocks sellers from cancelling packed, ready_to_dispatch, shipped, dispatched, or delivered splits
--   - Blocks cancellation if COD is already collected or settled
--   - Never restores stock for shipped/dispatched/delivered splits (even for ops admin)
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
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_so public.seller_orders%rowtype;
  v_is_ops_admin boolean := public.is_operations_admin(v_uid);
  v_is_owner_seller boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select order_id into v_order_id
  from public.seller_orders
  where id = p_seller_order_id;

  if not found then
    raise exception 'Seller order not found.';
  end if;

  -- Lock parent order BEFORE seller_orders to prevent AB/BA deadlocks with cancel_customer_order
  select * into v_order from public.orders where id = v_order_id for update;
  select * into v_so from public.seller_orders where id = p_seller_order_id for update;

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

  if not v_is_ops_admin and v_so.fulfilment_status in (
    'packed', 'ready_to_dispatch', 'shipped', 'dispatched', 'delivered'
  ) then
    raise exception 'Packed, ready-to-dispatch, dispatched, or delivered seller orders cannot be cancelled by the seller.';
  end if;

  if v_is_ops_admin and v_so.fulfilment_status = 'delivered' then
    raise exception 'Delivered orders must use the returns workflow.';
  end if;

  if v_order.payment_status = 'cod_collected'
     or v_so.cod_reconciliation_status in ('collected', 'settled') then
    raise exception 'Orders with collected or settled COD payments cannot be cancelled directly and must enter the refund and reconciliation workflow.';
  end if;

  -- Restore stock ONLY if the split has NOT already been dispatched or delivered
  if v_so.fulfilment_status not in ('shipped', 'dispatched', 'delivered') then
    perform public.internal_restore_seller_order_inventory(v_so.id);
  end if;

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
    coalesce(nullif(trim(p_reason), ''), 'Seller fulfilment cancelled'),
    v_uid
  );

  return jsonb_build_object('seller_order_id', v_so.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_seller_order(uuid, text) from public, anon;
grant execute on function public.cancel_seller_order(uuid, text) to authenticated;

-- Customer / Ops-Admin full or remaining-split order cancellation:
--   - Allows customers to cancel eligible remaining splits even when order_status = 'partially_cancelled'
--   - Skips already-cancelled splits cleanly
--   - Blocks if COD has already been collected or settled
--   - Never restores stock for already-dispatched/delivered splits (even for ops admin)
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

  if v_order.payment_status = 'cod_collected' or exists (
    select 1 from public.seller_orders
    where order_id = v_order.id
      and cod_reconciliation_status in ('collected', 'settled')
  ) then
    raise exception 'Orders with collected or settled COD payments cannot be cancelled directly and must enter the refund and reconciliation workflow.';
  end if;

  if not v_is_ops_admin then
    if v_order.order_status not in (
      'pending', 'pending_payment', 'confirmed', 'processing', 'partially_cancelled'
    ) then
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
    select id, fulfilment_status from public.seller_orders
    where order_id = v_order.id and fulfilment_status <> 'cancelled'
    order by id
    for update
  loop
    if v_so.fulfilment_status not in ('shipped', 'dispatched', 'delivered') then
      perform public.internal_restore_seller_order_inventory(v_so.id);
    end if;

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
    coalesce(nullif(trim(p_reason), ''), 'Order cancelled'),
    v_uid
  );

  return jsonb_build_object('order_id', v_order.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_customer_order(uuid, text) from public, anon;
grant execute on function public.cancel_customer_order(uuid, text) to authenticated;

commit;
