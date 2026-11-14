-- NOHAJ Marketplace — Phase 1: Storage Buckets & Policies
-- Migration: 003_storage_buckets.sql
-- Depends on: 002_rls_policies.sql
-- Safe to rerun: Yes (wrapped in transaction with DROP POLICY IF EXISTS).
-- Note: KYC read policy is further narrowed to operations/super admins in 005_security_and_schema_hardening.sql.

begin;

insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),
  ('seller-assets', 'seller-assets', true),
  ('seller-verification-docs', 'seller-verification-docs', false)
on conflict (id) do nothing;

-- Public read for product images and seller logos/banners
drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images"
  on storage.objects for select
  using (bucket_id in ('product-images', 'seller-assets'));

-- Authenticated sellers can upload to product-images and seller-assets (folder-scoped in 005)
drop policy if exists "Authenticated upload product images" on storage.objects;
create policy "Authenticated upload product images"
  on storage.objects for insert
  with check (bucket_id in ('product-images', 'seller-assets') and auth.role() = 'authenticated');

-- Private verification documents: replaced in 005 to exclude content_admin
drop policy if exists "Owner or admin read verification docs" on storage.objects;
create policy "Owner or admin read verification docs"
  on storage.objects for select
  using (
    bucket_id = 'seller-verification-docs'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin(auth.uid()))
  );

drop policy if exists "Seller upload own verification docs" on storage.objects;
create policy "Seller upload own verification docs"
  on storage.objects for insert
  with check (
    bucket_id = 'seller-verification-docs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
