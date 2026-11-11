-- NOHAJ Marketplace — Phase 1: Storage Buckets & Policies
-- Migration: 003_storage_buckets.sql

insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),
  ('seller-assets', 'seller-assets', true),
  ('seller-verification-docs', 'seller-verification-docs', false)
on conflict (id) do nothing;

-- Public read for product images and seller logos/banners
create policy "Public read product images"
  on storage.objects for select
  using (bucket_id in ('product-images', 'seller-assets'));

-- Authenticated sellers can upload to product-images and seller-assets
create policy "Authenticated upload product images"
  on storage.objects for insert
  with check (bucket_id in ('product-images', 'seller-assets') and auth.role() = 'authenticated');

-- Private verification documents: only owner or admin can read/upload
create policy "Owner or admin read verification docs"
  on storage.objects for select
  using (
    bucket_id = 'seller-verification-docs'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin(auth.uid()))
  );

create policy "Seller upload own verification docs"
  on storage.objects for insert
  with check (
    bucket_id = 'seller-verification-docs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
