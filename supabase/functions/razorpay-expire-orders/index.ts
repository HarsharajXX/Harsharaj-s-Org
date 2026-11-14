import { createServiceRoleRepository } from '../_shared/envClient.ts';
import { HttpRazorpayClient } from '../_shared/razorpayClient.ts';
import { handleExpireOnlineOrders } from './handler.ts';

Deno.serve(async (req: Request) => {
  const { repo, serviceRoleKey } = createServiceRoleRepository();
  const cronSecret = (Deno.env.get('CRON_SECRET') || '').trim();
  const razorpayKeyId = (Deno.env.get('RAZORPAY_KEY_ID') || '').trim();
  const razorpayKeySecret = (Deno.env.get('RAZORPAY_KEY_SECRET') || '').trim();

  const razorpayClient =
    razorpayKeyId && razorpayKeySecret
      ? new HttpRazorpayClient(razorpayKeyId, razorpayKeySecret)
      : null;

  return handleExpireOnlineOrders(req, {
    repo,
    razorpayClient,
    env: {
      cronSecret: cronSecret || undefined,
      serviceRoleKey,
    },
  });
});
