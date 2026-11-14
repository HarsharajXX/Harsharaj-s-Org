-- NOHAJ Marketplace — Stage 7 / 7.5: Security, RBAC, Storage, Seller Onboarding & Atomic Order RPC
-- Migration: 005_security_and_schema_hardening.sql
-- Depends on: 001_initial_schema.sql, 002_rls_policies.sql, 003_storage_buckets.sql, 004_commerce_engine.sql (superseded).
-- Safe to rerun: Yes (transaction-wrapped with explicit DROP IF EXISTS).

begin;

-- ============================================================================
-- 1. ROLE-BASED ACCESS CONTROL (RBAC) & ADMIN HELPERS
-- ============================================================================

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('customer', 'seller', 'admin', 'super_admin', 'operations_admin', 'content_admin'));

create or replace function public.has_role(uid uuid, required_role text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = required_role
  );
$$;

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('super_admin', 'admin')
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
    where user_id = uid and role in ('super_admin', 'admin', 'operations_admin')
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
    where user_id = uid and role in ('super_admin', 'admin', 'content_admin')
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
    where user_id = uid and role in ('super_admin', 'admin', 'operations_admin', 'content_admin')
  );
$$;

create or replace function public.is_seller(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.seller_profiles
    where user_id = uid and account_status = 'active'
  );
$$;

-- ============================================================================
-- 2. SCHEMA COMPLETENESS (SETTINGS, SELLER ONBOARDING, STOCK, NOTIFICATIONS)
-- ============================================================================

create table if not exists public.marketplace_settings (
  id integer primary key default 1 check (id = 1),
  commission_rate numeric(5, 4) not null default 0.1200 check (commission_rate >= 0 and commission_rate <= 0.5000),
  cod_enabled boolean not null default true,
  free_shipping_threshold numeric(10, 2) not null default 5000.00,
  flat_shipping_fee numeric(10, 2) not null default 250.00,
  return_window_days integer not null default 7,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.marketplace_settings (id, commission_rate, cod_enabled, free_shipping_threshold, flat_shipping_fee, return_window_days)
values (1, 0.1200, true, 5000.00, 250.00, 7)
on conflict (id) do nothing;

alter table public.marketplace_settings enable row level security;
drop policy if exists "Public read marketplace settings" on public.marketplace_settings;
create policy "Public read marketplace settings"
  on public.marketplace_settings for select using (true);
drop policy if exists "Super admin update marketplace settings" on public.marketplace_settings;
create policy "Super admin update marketplace settings"
  on public.marketplace_settings for update using (public.is_super_admin(auth.uid()));

-- Seller profiles: separate email verification from admin approval & payout eligibility
alter table public.seller_profiles
  add column if not exists district text,
  add column if not exists seller_type text default 'Artisan',
  add column if not exists categories text[] default '{}',
  add column if not exists social_link text,
  add column if not exists email_verified boolean not null default false,
  add column if not exists email_verified_at timestamptz;

alter table public.seller_profiles drop constraint if exists seller_profiles_account_status_check;
alter table public.seller_profiles
  add constraint seller_profiles_account_status_check
  check (account_status in (
    'pending_email_verification', 'pending_approval', 'active', 'suspended', 'rejected'
  ));

-- Products: non-variant stock fallback, suspended/archived status, fulfilment type
alter table public.products
  add column if not exists stock_quantity integer not null default 0 check (stock_quantity >= 0),
  add column if not exists fulfilment_type text not null default 'ready-to-ship'
    check (fulfilment_type in ('ready-to-ship', 'made-to-order'));

alter table public.products drop constraint if exists products_approval_status_check;
alter table public.products
  add constraint products_approval_status_check
  check (approval_status in ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived'));

-- Orders & Seller Orders status expansions + commission rate snapshot
alter table public.orders drop constraint if exists orders_order_status_check;
alter table public.orders
  add constraint orders_order_status_check
  check (order_status in (
    'pending', 'pending_payment', 'confirmed', 'processing',
    'partially_dispatched', 'dispatched', 'partially_fulfilled',
    'fulfilled', 'delivered', 'cancelled', 'partially_cancelled'
  ));

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in (
    'pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'cod_pending', 'cod_collected', 'cancelled'
  ));

alter table public.seller_orders
  add column if not exists commission_rate_snapshot numeric(5, 4) not null default 0.1200;

alter table public.seller_orders drop constraint if exists seller_orders_fulfilment_status_check;
alter table public.seller_orders
  add constraint seller_orders_fulfilment_status_check
  check (fulfilment_status in (
    'pending', 'accepted', 'processing', 'packed', 'ready_to_dispatch', 'shipped', 'dispatched', 'delivered', 'cancelled'
  ));

create table if not exists public.order_status_history (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references public.orders(id) on delete cascade,
  seller_order_id uuid references public.seller_orders(id) on delete cascade,
  status text not null,
  note text,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.order_status_history enable row level security;

create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_id on public.notifications(user_id);
alter table public.notifications enable row level security;

-- ============================================================================
-- 3. SIGNUP & EMAIL-VERIFICATION WORKFLOW (SEPARATED FROM ADMIN APPROVAL)
-- ============================================================================

-- Harden handle_new_user: never allow client to claim admin roles; email verification moves seller to pending_approval (not active)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intended_role text;
  v_store_name text;
  v_slug text;
  v_is_verified boolean := (new.email_confirmed_at is not null);
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) do nothing;

  v_intended_role := coalesce(new.raw_user_meta_data->>'intended_role', 'customer');

  -- Only 'seller' is permitted during public signup; admin roles can NEVER be self-assigned
  if v_intended_role = 'seller' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'seller')
    on conflict (user_id, role) do nothing;

    v_store_name := coalesce(nullif(trim(new.raw_user_meta_data->>'store_name'), ''), 'NOHAJ Artisan Store');
    v_slug := lower(regexp_replace(v_store_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 8);

    insert into public.seller_profiles (
      user_id, business_name, slug, owner_name, location, state, district,
      seller_type, contact_email, contact_phone,
      email_verified, email_verified_at,
      account_status, payout_verification_status
    ) values (
      new.id,
      v_store_name,
      v_slug,
      coalesce(new.raw_user_meta_data->>'full_name', 'Seller'),
      coalesce(new.raw_user_meta_data->>'district', '') || ', ' || coalesce(new.raw_user_meta_data->>'state', 'Assam'),
      coalesce(new.raw_user_meta_data->>'state', 'Assam'),
      new.raw_user_meta_data->>'district',
      coalesce(new.raw_user_meta_data->>'seller_type', 'Artisan'),
      new.email,
      new.raw_user_meta_data->>'phone',
      v_is_verified,
      new.email_confirmed_at,
      case when v_is_verified then 'pending_approval' else 'pending_email_verification' end,
      'unverified'
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- Record email confirmation independently; move pending_email_verification -> pending_approval (never auto-activate or verify payouts)
create or replace function public.handle_user_email_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.seller_profiles
    set
      email_verified = true,
      email_verified_at = new.email_confirmed_at,
      account_status = case
        when account_status = 'pending_email_verification' then 'pending_approval'
        else account_status
      end,
      updated_at = now()
    where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_verified on auth.users;
create trigger on_auth_user_email_verified
  after update of email_confirmed_at on auth.users
  for each row execute procedure public.handle_user_email_verified();

-- ============================================================================
-- 4. COLUMN-LEVEL SECURITY TRIGGERS (NO GENERAL BYPASSES)
-- ============================================================================

-- Prevent sellers from approving/publishing/suspending products; force re-review on sensitive edits
create or replace function public.guard_product_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_status text;
begin
  if not public.is_content_admin(auth.uid()) then
    if new.approval_status in ('approved', 'suspended') or new.is_published = true then
      if tg_op = 'INSERT' or (
        new.approval_status is distinct from old.approval_status or
        new.is_published is distinct from old.is_published
      ) then
        raise exception 'Only authorized NOHAJ administrators can approve, publish, or suspend products.';
      end if;
    end if;

    if tg_op = 'UPDATE' and (
      old.name is distinct from new.name or
      old.material is distinct from new.material or
      old.production_method is distinct from new.production_method or
      old.community_id is distinct from new.community_id or
      old.price is distinct from new.price
    ) and old.approval_status = 'approved' then
      new.approval_status := 'pending_review';
      new.is_published := false;
    end if;
  else
    -- Even content_admin cannot publish a product belonging to a non-active seller
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

drop trigger if exists on_product_sensitive_update on public.products;
create trigger on_product_sensitive_update
  before insert or update on public.products
  for each row execute procedure public.guard_product_moderation_columns();

-- Guard seller_profiles status, email_verified flags, and payout verification.
-- Only operations/super admins can change account_status or payout_verification_status.
-- The sole narrow non-admin exception is the internal auth.users email confirmation trigger transitioning
-- pending_email_verification -> pending_approval (with no HTTP JWT claim present).
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
    and current_user in ('postgres', 'supabase_auth_admin')
    and old.email_verified = false
    and new.email_verified = true
    and new.email_verified_at is not null
    and new.payout_verification_status is not distinct from old.payout_verification_status
    and (
      new.account_status is not distinct from old.account_status
      or (old.account_status = 'pending_email_verification' and new.account_status = 'pending_approval')
    )
  );
begin
  if not public.is_operations_admin(auth.uid()) and not v_is_internal_auth_sync then
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

drop trigger if exists on_guard_seller_profile_status on public.seller_profiles;
create trigger on_guard_seller_profile_status
  before update on public.seller_profiles
  for each row execute procedure public.guard_seller_profile_status();

-- Prevent sellers or customers from altering financial totals, commission snapshot, or COD reconciliation.
-- create_multi_vendor_order() inserts final values directly so zero financial UPDATE is needed there.
create or replace function public.guard_seller_order_financials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_operations_admin(auth.uid()) then
    if new.subtotal is distinct from old.subtotal
       or new.commission_rate_snapshot is distinct from old.commission_rate_snapshot
       or new.commission_amount is distinct from old.commission_amount
       or new.seller_payout_amount is distinct from old.seller_payout_amount then
      raise exception 'Only authorized administrators can alter seller order financial totals.';
    end if;

    -- On COD cancellation via cancel_seller_order(), allow awaiting_collection -> not_applicable only when cancelling
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

drop trigger if exists on_guard_seller_order_financials on public.seller_orders;
create trigger on_guard_seller_order_financials
  before update on public.seller_orders
  for each row execute procedure public.guard_seller_order_financials();

-- ============================================================================
-- 5. COMPLETE MISSING RLS POLICIES FOR ALL TABLES
-- ============================================================================

-- Allow verified-email sellers (pending_approval or active) to insert drafts/pending_review products
drop policy if exists "Sellers insert own products" on public.products;
create policy "Sellers insert own products"
  on public.products for insert
  with check (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id
        and sp.user_id = auth.uid()
        and sp.email_verified = true
        and sp.account_status in ('pending_approval', 'active')
    )
  );

-- PRODUCT IMAGES & VARIANTS
drop policy if exists "Public read product images of published products" on public.product_images;
create policy "Public read product images of published products"
  on public.product_images for select
  using (
    exists (
      select 1 from public.products p
      left join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_id
        and ((p.approval_status = 'approved' and p.is_published = true)
             or sp.user_id = auth.uid()
             or public.is_admin(auth.uid()))
    )
  );

drop policy if exists "Sellers manage own product images" on public.product_images;
create policy "Sellers manage own product images"
  on public.product_images for all
  using (
    exists (
      select 1 from public.products p
      join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_id and sp.user_id = auth.uid()
    ) or public.is_content_admin(auth.uid())
  );

drop policy if exists "Public read variants of published products" on public.product_variants;
create policy "Public read variants of published products"
  on public.product_variants for select
  using (
    exists (
      select 1 from public.products p
      left join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_id
        and ((p.approval_status = 'approved' and p.is_published = true)
             or sp.user_id = auth.uid()
             or public.is_admin(auth.uid()))
    )
  );

drop policy if exists "Sellers manage own product variants" on public.product_variants;
create policy "Sellers manage own product variants"
  on public.product_variants for all
  using (
    exists (
      select 1 from public.products p
      join public.seller_profiles sp on sp.id = p.seller_id
      where p.id = product_id and sp.user_id = auth.uid()
    ) or public.is_content_admin(auth.uid())
  );

-- COMMUNITIES & CATEGORIES (Content Admin writes)
drop policy if exists "Content admins manage communities" on public.communities;
create policy "Content admins manage communities"
  on public.communities for all
  using (public.is_content_admin(auth.uid()))
  with check (public.is_content_admin(auth.uid()));

drop policy if exists "Content admins manage categories" on public.categories;
create policy "Content admins manage categories"
  on public.categories for all
  using (public.is_content_admin(auth.uid()))
  with check (public.is_content_admin(auth.uid()));

-- USER ROLES (Super Admin manages)
drop policy if exists "Super admins manage user roles" on public.user_roles;
create policy "Super admins manage user roles"
  on public.user_roles for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

-- ORDER ITEMS, SHIPMENTS, ORDER STATUS HISTORY
drop policy if exists "Customers sellers admins read order items" on public.order_items;
create policy "Customers sellers admins read order items"
  on public.order_items for select
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Customers sellers admins read shipments" on public.shipments;
create policy "Customers sellers admins read shipments"
  on public.shipments for select
  using (
    exists (
      select 1 from public.seller_orders so
      join public.orders o on o.id = so.order_id
      where so.id = seller_order_id and o.customer_id = auth.uid()
    )
    or exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Sellers manage own shipments" on public.shipments;
create policy "Sellers manage own shipments"
  on public.shipments for insert
  with check (
    exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    ) or public.is_operations_admin(auth.uid())
  );

drop policy if exists "Read own order history" on public.order_status_history;
create policy "Read own order history"
  on public.order_status_history for select
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or exists (
      select 1 from public.seller_orders so
      join public.seller_profiles sp on sp.id = so.seller_id
      where so.id = seller_order_id and sp.user_id = auth.uid()
    )
    or public.is_operations_admin(auth.uid())
  );

-- REVIEWS, RETURNS, NOTIFICATIONS, AUDIT LOGS
drop policy if exists "Public read reviews" on public.reviews;
create policy "Public read reviews" on public.reviews for select using (true);
drop policy if exists "Customers create own reviews" on public.reviews;
create policy "Customers create own reviews" on public.reviews for insert with check (auth.uid() = customer_id);
drop policy if exists "Content admins moderate reviews" on public.reviews;
create policy "Content admins moderate reviews" on public.reviews for delete using (public.is_content_admin(auth.uid()) or auth.uid() = customer_id);

drop policy if exists "Customers view and request returns" on public.returns;
create policy "Customers view and request returns"
  on public.returns for select
  using (auth.uid() = customer_id or public.is_operations_admin(auth.uid()));
drop policy if exists "Customers insert own returns" on public.returns;
create policy "Customers insert own returns"
  on public.returns for insert with check (auth.uid() = customer_id);
drop policy if exists "Operations admin manage returns" on public.returns;
create policy "Operations admin manage returns"
  on public.returns for update using (public.is_operations_admin(auth.uid()));

drop policy if exists "Users manage own notifications" on public.notifications;
create policy "Users manage own notifications"
  on public.notifications for all using (auth.uid() = user_id);

drop policy if exists "Admins insert audit logs" on public.audit_logs;
create policy "Admins insert audit logs"
  on public.audit_logs for insert with check (public.is_admin(auth.uid()));

-- ============================================================================
-- 6. STORAGE HARDENING (MIME TYPES, FILE SIZE, FOLDER OWNERSHIP, KYC PRIVACY)
-- ============================================================================

update storage.buckets
set
  file_size_limit = 5242880, -- 5MB
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('product-images', 'seller-assets');

update storage.buckets
set
  public = false,
  file_size_limit = 10485760, -- 10MB
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
where id = 'seller-verification-docs';

-- Product images & seller assets (folder-scoped to seller role UID)
drop policy if exists "Authenticated upload product images" on storage.objects;
drop policy if exists "Sellers upload own folder images" on storage.objects;
create policy "Sellers upload own folder images"
  on storage.objects for insert
  with check (
    bucket_id in ('product-images', 'seller-assets')
    and auth.role() = 'authenticated'
    and public.has_role(auth.uid(), 'seller')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Sellers update own folder images" on storage.objects;
create policy "Sellers update own folder images"
  on storage.objects for update
  using (
    bucket_id in ('product-images', 'seller-assets')
    and public.has_role(auth.uid(), 'seller')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Sellers update delete own folder images" on storage.objects;
create policy "Sellers update delete own folder images"
  on storage.objects for delete
  using (
    bucket_id in ('product-images', 'seller-assets')
    and public.has_role(auth.uid(), 'seller')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Private seller verification documents: ONLY owner or super_admin / operations_admin (NEVER content_admin or public)
drop policy if exists "Owner or admin read verification docs" on storage.objects;
drop policy if exists "Owner or operations admin read verification docs" on storage.objects;
create policy "Owner or operations admin read verification docs"
  on storage.objects for select
  using (
    bucket_id = 'seller-verification-docs'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.is_operations_admin(auth.uid())
    )
  );

drop policy if exists "Seller upload own verification docs" on storage.objects;
create policy "Seller upload own verification docs"
  on storage.objects for insert
  with check (
    bucket_id = 'seller-verification-docs'
    and auth.role() = 'authenticated'
    and public.has_role(auth.uid(), 'seller')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Seller delete own verification docs" on storage.objects;
create policy "Seller delete own verification docs"
  on storage.objects for delete
  using (
    bucket_id = 'seller-verification-docs'
    and public.has_role(auth.uid(), 'seller')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- 7. HARDENED ATOMIC MULTI-VENDOR ORDER RPC (SINGLE-INSERT SELLER FINANCIALS)
-- ============================================================================

-- Permanently drop insecure 4-argument signature from 004
drop function if exists public.create_multi_vendor_order(uuid, jsonb, text, jsonb);

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
  v_item jsonb;
  v_product record;
  v_variant record;
  v_seller record;
  v_settings record;
  v_seller_group record;
  v_seller_order_id uuid;
  v_unit_price numeric(10, 2);
  v_qty integer;
  v_line_total numeric(10, 2);
  v_variant_id uuid;
  v_has_variants boolean;
  v_commission numeric(10, 2);
  v_payout numeric(10, 2);
begin
  if v_customer_id is null then
    raise exception 'Authentication required to place an order.';
  end if;

  if p_payment_method not in ('online', 'cod') then
    raise exception 'Invalid payment method.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

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

  -- PASS 1: Lock rows, validate product/seller/variant/stock, deduct inventory atomically, buffer lines
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be positive.';
    end if;

    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;

    select * into v_product from public.products
    where id = (v_item->>'product_id')::uuid
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

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
      where id = v_variant_id and product_id = v_product.id
      for update;

      if not found then
        raise exception 'Invalid variant for product %.', v_product.name;
      end if;

      if v_variant.stock_quantity < v_qty then
        raise exception 'Insufficient variant stock for %.', v_product.name;
      end if;

      -- Deduct ONLY variant stock; do not touch base products.stock_quantity
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
      v_product.seller_id, v_product.id, v_variant_id, v_product.name, v_qty, v_unit_price, v_line_total
    );
  end loop;

  v_shipping := case when v_subtotal >= v_settings.free_shipping_threshold then 0 else v_settings.flat_shipping_fee end;
  v_total := v_subtotal + v_shipping;
  v_order_number := 'NHJ-' || floor(100000 + random() * 900000)::text;

  -- PASS 2: Insert parent order with exact computed totals
  insert into public.orders (
    order_number, customer_id, shipping_address,
    subtotal, shipping_amount, total_amount,
    payment_method, payment_status, order_status
  ) values (
    v_order_number, v_customer_id, p_shipping_address,
    v_subtotal, v_shipping, v_total,
    p_payment_method,
    case when p_payment_method = 'cod' then 'cod_pending' else 'pending' end,
    case when p_payment_method = 'cod' then 'confirmed' else 'pending_payment' end
  )
  returning id into v_order_id;

  -- PASS 3: Insert each seller_order ONCE with final subtotal, commission snapshot, and payout (no UPDATE needed)
  for v_seller_group in
    select seller_id, sum(line_total) as seller_subtotal
    from _mv_order_lines
    group by seller_id
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
      'pending',
      case when p_payment_method = 'cod' then 'awaiting_collection' else 'not_applicable' end
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
    where seller_id = v_seller_group.seller_id;
  end loop;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (
    v_order_id,
    case when p_payment_method = 'cod' then 'confirmed' else 'pending_payment' end,
    'Order initialized via ' || upper(p_payment_method),
    v_customer_id
  );

  return v_order_id;
end;
$$;

revoke all on function public.create_multi_vendor_order(jsonb, text, jsonb) from public, anon;
grant execute on function public.create_multi_vendor_order(jsonb, text, jsonb) to authenticated;

commit;
