# `razorpay-expire-orders` Scheduled Inventory Reconciliation Worker

Releases reserved stock for abandoned or expired online checkouts (`pending_payment` past `reservation_expires_at`, including bounded uncaptured `authorized` holds) **after** checking actual Razorpay payment state.

## Authentication

- Public unauthenticated requests (`POST` without `x-cron-secret` or `Authorization: Bearer`) are rejected with `401`.
- Customer JWTs or mismatched secrets are rejected with `403`.
- Comparisons use constant-time `timingSafeEqualStrings` (`crypto.ts`) and never log secret values or `Authorization` headers.

Accepted server credentials:
1. `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`
2. `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (for internal Supabase `pg_cron` + `pg_net` invocations using Vault-stored service-role credentials)

## Lifecycle Behaviour

1. Queries `orders` in `pending_payment` (`created | pending | failed | authorized`) whose `reservation_expires_at <= now()` and `reservation_released_at is null`.
2. For orders that have Razorpay attempts, queries Razorpay (`GET /v1/orders/{id}/payments` / `GET /v1/payments/{id}`).
   - If Razorpay reports `status === 'captured'`, stock is **never** restored; the worker atomically reconciles via `finalize_online_payment_capture(...)`.
   - If Razorpay API inspection fails transiently, release is deferred to the next cron run so captured orders are never falsely expired.
3. Otherwise calls `release_expired_online_order_inventory(order_id, 'expired')` exact-once (`FOR UPDATE OF o SKIP LOCKED` + `reservation_released_at is null`).

## Scheduled Invocation (Every 5 Minutes)

### Option A: Supabase `pg_cron` + `pg_net`

Store the project URL and `CRON_SECRET` in Supabase Vault, then schedule:

```sql
select cron.schedule(
  'nohaj-razorpay-expire-orders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/razorpay-expire-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### Option B: External Scheduler / GitHub Actions

```bash
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/razorpay-expire-orders" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -d '{}'
```
