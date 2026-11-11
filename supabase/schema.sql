-- NOHAJ Marketplace — Supabase PostgreSQL Schema & Row Level Security (RLS)
-- Run this in your Supabase SQL Editor when provisioning the live database.

create extension if not exists "uuid-ossp";

-- COMMUNITIES
create table if not exists communities (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  state text not null,
  description text not null,
  cultural_note text,
  cover_image text
);

-- SELLERS
create table if not exists sellers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  business_name text not null,
  owner_name text not null,
  location text not null,
  contact_email text not null,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'suspended')),
  created_at timestamptz default now()
);

-- PRODUCTS
create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  name text not null,
  description text not null,
  price numeric(10, 2) not null,
  community_id uuid references communities(id),
  category_id text not null,
  material text not null,
  production_method text not null,
  images text[] not null default '{}',
  sizes text[] not null default '{}',
  colours text[] not null default '{}',
  availability text not null default 'In Stock',
  dispatch_time text not null,
  seller_id uuid references sellers(id) not null,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  created_at timestamptz default now()
);

-- ORDERS
create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid references auth.users(id) not null,
  total numeric(10, 2) not null,
  shipping_amount numeric(10, 2) not null default 0,
  status text not null default 'pending',
  payment_status text not null default 'unpaid',
  shipping_address jsonb not null,
  created_at timestamptz default now()
);

-- ORDER ITEMS
create table if not exists order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references orders(id) on delete cascade not null,
  product_id uuid references products(id) not null,
  seller_id uuid references sellers(id) not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null
);

-- WISHLISTS
create table if not exists wishlists (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid references auth.users(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  unique(customer_id, product_id)
);

-- SELLER APPLICATIONS
create table if not exists seller_applications (
  id uuid primary key default uuid_generate_v4(),
  applicant_name text not null,
  business_name text not null,
  contact text not null,
  location text not null,
  categories text[] not null,
  description text not null,
  status text not null default 'submitted',
  created_at timestamptz default now()
);

-- ROW LEVEL SECURITY
alter table communities enable row level security;
alter table sellers enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table wishlists enable row level security;
alter table seller_applications enable row level security;

-- Public read access for communities and verified products
create policy "Public can view communities" on communities for select using (true);
create policy "Public can view verified products" on products for select using (verification_status = 'verified');

-- Customers can only access their own orders and wishlists
create policy "Customers view own orders" on orders for select using (auth.uid() = customer_id);
create policy "Customers create own orders" on orders for insert with check (auth.uid() = customer_id);
create policy "Customers manage own wishlist" on wishlists for all using (auth.uid() = customer_id);

-- Anyone can submit a seller application
create policy "Public can submit seller application" on seller_applications for insert with check (true);
