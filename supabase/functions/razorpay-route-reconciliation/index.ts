import { createServiceRoleRepository } from '../_shared/envClient.ts';
import { HttpRazorpayClient } from '../_shared/razorpayClient.ts';
import { handleRouteSettlementReconciliation } from './handler.ts';

Deno.serve(async (req: Request) => {
  const razorpayKeyId = (Deno.env.get('RAZORPAY_KEY_ID') || '').trim();
  const razorpayKeySecret = (Deno.env.get('RAZORPAY_KEY_SECRET') || '').trim();
  const razorpayRouteEnabled = (Deno.env.get('RAZORPAY_ROUTE_ENABLED') || 'false').trim().toLowerCase() === 'true';
  const cronSecret = (Deno.env.get('RAZORPAY_EXPIRE_CRON_SECRET') || '').trim();
  const { repo, serviceRoleKey } = createServiceRoleRepository();

  const razorpayClient =
    razorpayKeyId && razorpayKeySecret
      ? new HttpRazorpayClient(razorpayKeyId, razorpayKeySecret)
      : null;

  return handleRouteSettlementReconciliation(req, {
    repo,
    razorpayClient,
    env: {
      razorpayKeyId,
      razorpayKeySecret,
      razorpayRouteEnabled,
      cronSecret,
      serviceRoleKey,
    },
  });
});
