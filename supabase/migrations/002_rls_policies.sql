-- NOHAJ Marketplace — Phase 1: Row Level Security (RLS) Policies
-- Migration: 002_rls_policies.sql
-- Depends on: 001_initial_schema.sql
-- Safe to rerun: Yes (all policies dropped before recreation; wrapped in transaction).

begin;

-- Helper functions (hardened in 005 with search_path and 5-role RBAC)
create or replace function public.is_admin(uid uuid)
returns boolean as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('admin', 'super_admin', 'operations_admin', 'content_admin')
  );
$$ language sql security definer stable set search_path = public;

create or replace function public.is_seller(uid uuid)
returns boolean as $$
  select exists (
    select 1 from public.seller_profiles
    where user_id = uid and account_status = 'active'
  );
$$ language sql security definer stable set search_path = public;

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.communities enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.addresses enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlists enable row level security;
alter table public.orders enable row level security;
alter table public.seller_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.shipments enable row level security;
alter table public.reviews enable row level security;
alter table public.seller_applications enable row level security;
alter table public.returns enable row level security;
alter table public.audit_logs enable row level security;

-- PROFILES & ROLES
drop policy if exists "Users view own profile" on public.profiles;
create policy "Users view own profile" on public.profiles
  for select using (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "Users view own roles" on public.user_roles;
create policy "Users view own roles" on public.user_roles
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- PUBLIC CATALOGUE
drop policy if exists "Public read communities" on public.communities;
create policy "Public read communities" on public.communities
  for select using (true);

drop policy if exists "Public read categories" on public.categories;
create policy "Public read categories" on public.categories
  for select using (true);

drop policy if exists "Public read approved published products" on public.products;
create policy "Public read approved published products" on public.products
  for select using (
    (approval_status = 'approved' and is_published = true)
    or exists (select 1 from public.seller_profiles sp where sp.id = seller_id and sp.user_id = auth.uid())
    or public.is_admin(auth.uid())
  );

-- SELLERS MANAGE OWN PRODUCTS
drop policy if exists "Sellers insert own products" on public.products;
create policy "Sellers insert own products" on public.products
  for insert with check (
    exists (
      select 1 from public.seller_profiles sp
      where sp.id = seller_id
        and sp.user_id = auth.uid()
        and sp.account_status in ('pending_approval', 'active')
    )
  );

drop policy if exists "Sellers update own products" on public.products;
create policy "Sellers update own products" on public.products
  for update using (
    exists (select 1 from public.seller_profiles sp where sp.id = seller_id and sp.user_id = auth.uid())
    or public.is_admin(auth.uid())
  );

-- SELLER PROFILES (further restricted to owners/admins + public_seller_directory view in 006)
drop policy if exists "Public read active seller profiles" on public.seller_profiles;
create policy "Public read active seller profiles" on public.seller_profiles
  for select using (account_status = 'active' or user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "Users update own seller profile" on public.seller_profiles;
create policy "Users update own seller profile" on public.seller_profiles
  for update using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- CUSTOMER PRIVATE DATA
drop policy if exists "Customers manage own addresses" on public.addresses;
create policy "Customers manage own addresses" on public.addresses
  for all using (auth.uid() = user_id);

drop policy if exists "Customers manage own cart" on public.carts;
create policy "Customers manage own cart" on public.carts
  for all using (auth.uid() = user_id);

drop policy if exists "Customers manage own cart items" on public.cart_items;
create policy "Customers manage own cart items" on public.cart_items
  for all using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));

drop policy if exists "Customers manage own wishlist" on public.wishlists;
create policy "Customers manage own wishlist" on public.wishlists
  for all using (auth.uid() = user_id);

-- ORDERS & FULFILMENT
drop policy if exists "Customers view own orders" on public.orders;
create policy "Customers view own orders" on public.orders
  for select using (auth.uid() = customer_id or public.is_admin(auth.uid()));

drop policy if exists "Sellers view own seller_orders" on public.seller_orders;
create policy "Sellers view own seller_orders" on public.seller_orders
  for select using (
    exists (select 1 from public.seller_profiles sp where sp.id = seller_id and sp.user_id = auth.uid())
    or public.is_admin(auth.uid())
  );

drop policy if exists "Sellers update own seller_orders" on public.seller_orders;
create policy "Sellers update own seller_orders" on public.seller_orders
  for update using (
    exists (select 1 from public.seller_profiles sp where sp.id = seller_id and sp.user_id = auth.uid())
    or public.is_admin(auth.uid())
  );

-- PAYMENTS & AUDIT LOGS (Protected)
drop policy if exists "Customers view own payments" on public.payments;
create policy "Customers view own payments" on public.payments
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or public.is_admin(auth.uid())
  );

drop policy if exists "Admins only view audit logs" on public.audit_logs;
create policy "Admins only view audit logs" on public.audit_logs
  for select using (public.is_admin(auth.uid()));

-- SELLER APPLICATIONS
drop policy if exists "Public submit seller application" on public.seller_applications;
create policy "Public submit seller application" on public.seller_applications
  for insert with check (true);

drop policy if exists "Admins view seller applications" on public.seller_applications;
create policy "Admins view seller applications" on public.seller_applications
  for select using (public.is_admin(auth.uid()));

commit;
