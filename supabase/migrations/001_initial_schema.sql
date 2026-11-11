-- NOHAJ Marketplace — Phase 1: Initial Database Schema
-- Migration: 001_initial_schema.sql

create extension if not exists "uuid-ossp";

-- 1. PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique not null,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. USER ROLES (RBAC: customer | seller | admin)
create table if not exists public.user_roles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('customer', 'seller', 'admin')),
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
create index if not exists idx_user_roles_user_id on public.user_roles(user_id);

-- 3. SELLER PROFILES
create table if not exists public.seller_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid unique not null references public.profiles(id) on delete cascade,
  business_name text not null,
  slug text unique not null,
  owner_name text not null,
  location text not null,
  state text not null default 'Assam',
  bio text,
  logo_url text,
  banner_url text,
  contact_email text not null,
  contact_phone text,
  account_status text not null default 'pending_email_verification'
    check (account_status in ('pending_email_verification', 'active', 'suspended')),
  payout_verification_status text not null default 'unverified'
    check (payout_verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seller_profiles_user_id on public.seller_profiles(user_id);

-- 4. COMMUNITIES
create table if not exists public.communities (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  state text not null,
  description text not null,
  cultural_note text,
  cover_image text,
  created_at timestamptz not null default now()
);

-- 5. CATEGORIES
create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  description text,
  created_at timestamptz not null default now()
);

-- 6. PRODUCTS
create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  community_id uuid references public.communities(id),
  category_id uuid references public.categories(id),
  slug text unique not null,
  name text not null,
  description text not null,
  price numeric(10, 2) not null check (price >= 0),
  material text not null,
  production_method text not null,
  measurements text,
  care_instructions text,
  dispatch_time text not null default '3-5 business days',
  availability text not null default 'In Stock'
    check (availability in ('In Stock', 'Made to Order', 'Limited Run', 'Out of Stock')),
  approval_status text not null default 'draft'
    check (approval_status in ('draft', 'pending_review', 'approved', 'rejected')),
  is_published boolean not null default false,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_seller_id on public.products(seller_id);
create index if not exists idx_products_community_id on public.products(community_id);
create index if not exists idx_products_approval_published on public.products(approval_status, is_published);

-- 7. PRODUCT IMAGES
create table if not exists public.product_images (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_images_product_id on public.product_images(product_id);

-- 8. PRODUCT VARIANTS
create table if not exists public.product_variants (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null default 'Free Size',
  colour text not null default 'Natural',
  sku text unique,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  price_override numeric(10, 2),
  created_at timestamptz not null default now()
);
create index if not exists idx_product_variants_product_id on public.product_variants(product_id);

-- 9. ADDRESSES
create table if not exists public.addresses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'India',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_addresses_user_id on public.addresses(user_id);

-- 10. CARTS
create table if not exists public.carts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid unique not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 11. CART ITEMS
create table if not exists public.cart_items (
  id uuid primary key default uuid_generate_v4(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique(cart_id, product_id, variant_id)
);

-- 12. WISHLISTS
create table if not exists public.wishlists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, product_id)
);

-- 13. ORDERS (Customer-level parent order)
create table if not exists public.orders (
  id uuid primary key default uuid_generate_v4(),
  order_number text unique not null,
  customer_id uuid not null references public.profiles(id),
  shipping_address jsonb not null,
  subtotal numeric(10, 2) not null,
  shipping_amount numeric(10, 2) not null default 0,
  total_amount numeric(10, 2) not null,
  payment_method text not null check (payment_method in ('online', 'cod')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'cod_pending', 'cod_collected', 'failed', 'refunded')),
  order_status text not null default 'pending'
    check (order_status in ('pending', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_customer_id on public.orders(customer_id);

-- 14. SELLER ORDERS (Independent seller fulfilment per order)
create table if not exists public.seller_orders (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_id uuid not null references public.seller_profiles(id),
  subtotal numeric(10, 2) not null,
  commission_amount numeric(10, 2) not null default 0,
  seller_payout_amount numeric(10, 2) not null default 0,
  fulfilment_status text not null default 'pending'
    check (fulfilment_status in ('pending', 'accepted', 'packed', 'shipped', 'delivered', 'cancelled')),
  cod_reconciliation_status text default 'not_applicable'
    check (cod_reconciliation_status in ('not_applicable', 'awaiting_collection', 'collected', 'settled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seller_orders_order_id on public.seller_orders(order_id);
create index if not exists idx_seller_orders_seller_id on public.seller_orders(seller_id);

-- 15. ORDER ITEMS
create table if not exists public.order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  seller_order_id uuid not null references public.seller_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_items_order_id on public.order_items(order_id);

-- 16. PAYMENTS
create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_payment_id text,
  amount numeric(10, 2) not null,
  currency text not null default 'INR',
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'captured', 'failed', 'refunded')),
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_payments_order_id on public.payments(order_id);

-- 17. SHIPMENTS
create table if not exists public.shipments (
  id uuid primary key default uuid_generate_v4(),
  seller_order_id uuid not null references public.seller_orders(id) on delete cascade,
  carrier text,
  tracking_number text,
  tracking_url text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- 18. REVIEWS
create table if not exists public.reviews (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique(product_id, customer_id)
);

-- 19. SELLER APPLICATIONS
create table if not exists public.seller_applications (
  id uuid primary key default uuid_generate_v4(),
  applicant_name text not null,
  business_name text not null,
  phone text not null,
  email text not null,
  location text not null,
  categories text[] not null default '{}',
  community_association text,
  description text not null,
  social_link text,
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- 20. RETURNS
create table if not exists public.returns (
  id uuid primary key default uuid_generate_v4(),
  seller_order_id uuid not null references public.seller_orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id),
  reason text not null,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'received', 'refunded')),
  created_at timestamptz not null default now()
);

-- 21. AUDIT LOGS
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_table text not null,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);

-- TRIGGERS: Auto-create profile & default customer role on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer');

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- TRIGGER: Re-review product if sensitive claims are modified by seller
create or replace function public.handle_product_sensitive_update()
returns trigger as $$
begin
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
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_product_sensitive_update on public.products;
create trigger on_product_sensitive_update
  before update on public.products
  for each row execute procedure public.handle_product_sensitive_update();
