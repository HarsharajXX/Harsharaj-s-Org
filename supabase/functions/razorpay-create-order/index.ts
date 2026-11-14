import { createServiceRoleRepository } from '../_shared/envClient.ts';
import { HttpRazorpayClient } from '../_shared/razorpayClient.ts';
import { handleCreateRazorpayOrder } from './handler.ts';

Deno.serve(async (req: Request) => {
  const razorpayKeyId = (Deno.env.get('RAZORPAY_KEY_ID') || '').trim();
  const razorpayKeySecret = (Deno.env.get('RAZORPAY_KEY_SECRET') || '').trim();
  const razorpayWebhookSecretConfigured = Boolean((Deno.env.get('RAZORPAY_WEBHOOK_SECRET') || '').trim());
  const { repo } = createServiceRoleRepository();

  const razorpayClient =
    razorpayKeyId && razorpayKeySecret
      ? new HttpRazorpayClient(razorpayKeyId, razorpayKeySecret)
      : null;

  return handleCreateRazorpayOrder(req, {
    repo,
    razorpayClient,
    env: {
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecretConfigured,
    },
  });
});
