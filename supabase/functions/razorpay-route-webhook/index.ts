import { createServiceRoleRepository } from '../_shared/envClient.ts';
import { HttpRazorpayClient } from '../_shared/razorpayClient.ts';
import { handleRazorpayRouteWebhook } from './handler.ts';

Deno.serve(async (req: Request) => {
  const razorpayWebhookSecret = (Deno.env.get('RAZORPAY_WEBHOOK_SECRET') || '').trim();
  const razorpayKeyId = (Deno.env.get('RAZORPAY_KEY_ID') || '').trim();
  const razorpayKeySecret = (Deno.env.get('RAZORPAY_KEY_SECRET') || '').trim();
  const razorpayRouteEnabled = (Deno.env.get('RAZORPAY_ROUTE_ENABLED') || 'false').trim().toLowerCase() === 'true';
  const { repo } = createServiceRoleRepository();

  const razorpayClient =
    razorpayKeyId && razorpayKeySecret
      ? new HttpRazorpayClient(razorpayKeyId, razorpayKeySecret)
      : null;

  return handleRazorpayRouteWebhook(req, {
    repo,
    razorpayClient,
    env: {
      razorpayWebhookSecret,
      razorpayRouteEnabled,
    },
  });
});
