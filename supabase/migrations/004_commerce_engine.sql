-- NOHAJ Marketplace — Stage 6: Atomic Multi-Vendor Order & Inventory Engine
-- Migration: 004_commerce_engine.sql

-- Atomic multi-vendor order creation with row-level stock locking
create or replace function public.create_multi_vendor_order(
  p_customer_id uuid,
  p_shipping_address jsonb,
  p_payment_method text,
  p_items jsonb -- array of { product_id, variant_id, quantity }
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(10, 2) := 0;
  v_shipping numeric(10, 2) := 0;
  v_total numeric(10, 2) := 0;
  v_item jsonb;
  v_product record;
  v_variant record;
  v_seller_id uuid;
  v_seller_order_id uuid;
  v_unit_price numeric(10, 2);
  v_qty integer;
  v_commission_rate numeric(5, 4) := 0.12;
begin
  if p_payment_method not in ('online', 'cod') then
    raise exception 'Invalid payment method';
  end if;

  v_order_number := 'NHJ-' || floor(100000 + random() * 900000)::text;

  insert into public.orders (
    order_number, customer_id, shipping_address,
    subtotal, shipping_amount, total_amount,
    payment_method, payment_status, order_status
  ) values (
    v_order_number, p_customer_id, p_shipping_address,
    0, 0, 0,
    p_payment_method,
    case when p_payment_method = 'cod' then 'cod_pending' else 'pending' end,
    case when p_payment_method = 'cod' then 'confirmed' else 'pending' end
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty <= 0 then
      raise exception 'Quantity must be positive';
    end if;

    select * into v_product from public.products
    where id = (v_item->>'product_id')::uuid and is_published = true;

    if not found then
      raise exception 'Product not available';
    end if;

    v_unit_price := v_product.price;
    v_seller_id := v_product.seller_id;

    -- Lock variant row if present and decrement stock atomically
    if v_item->>'variant_id' is not null then
      select * into v_variant from public.product_variants
      where id = (v_item->>'variant_id')::uuid
      for update;

      if not found or v_variant.stock_quantity < v_qty then
        raise exception 'Insufficient stock for product %', v_product.name;
      end if;

      update public.product_variants
      set stock_quantity = stock_quantity - v_qty
      where id = v_variant.id;
    end if;

    -- Find or create seller_order for this seller
    select id into v_seller_order_id from public.seller_orders
    where order_id = v_order_id and seller_id = v_seller_id;

    if not found then
      insert into public.seller_orders (
        order_id, seller_id, subtotal, commission_amount, seller_payout_amount,
        fulfilment_status, cod_reconciliation_status
      ) values (
        v_order_id, v_seller_id, 0, 0, 0,
        'pending',
        case when p_payment_method = 'cod' then 'awaiting_collection' else 'not_applicable' end
      )
      returning id into v_seller_order_id;
    end if;

    insert into public.order_items (
      order_id, seller_order_id, product_id, variant_id,
      product_name, quantity, unit_price
    ) values (
      v_order_id, v_seller_order_id, v_product.id, (v_item->>'variant_id')::uuid,
      v_product.name, v_qty, v_unit_price
    );

    update public.seller_orders
    set
      subtotal = subtotal + (v_unit_price * v_qty),
      commission_amount = (subtotal + (v_unit_price * v_qty)) * v_commission_rate,
      seller_payout_amount = (subtotal + (v_unit_price * v_qty)) * (1 - v_commission_rate)
    where id = v_seller_order_id;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);
  end loop;

  v_shipping := case when v_subtotal >= 5000 then 0 else 250 end;
  v_total := v_subtotal + v_shipping;

  update public.orders
  set subtotal = v_subtotal, shipping_amount = v_shipping, total_amount = v_total
  where id = v_order_id;

  return v_order_id;
end;
$$;
