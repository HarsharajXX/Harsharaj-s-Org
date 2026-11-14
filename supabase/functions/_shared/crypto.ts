const encoder = new TextEncoder();

export function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  if (!secret) {
    throw new Error('HMAC secret must not be empty.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0 && a.length > 0;
}

export async function verifyRazorpayCheckoutSignature(params: {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
  keySecret: string;
}): Promise<boolean> {
  const { providerOrderId, providerPaymentId, signature, keySecret } = params;
  if (!providerOrderId || !providerPaymentId || !signature || !keySecret) {
    return false;
  }
  const expected = await hmacSha256Hex(keySecret, `${providerOrderId}|${providerPaymentId}`);
  return timingSafeEqualStrings(expected.toLowerCase(), signature.trim().toLowerCase());
}

export async function verifyRazorpayWebhookSignature(params: {
  rawBody: string;
  signature: string;
  webhookSecret: string;
}): Promise<boolean> {
  const { rawBody, signature, webhookSecret } = params;
  if (!rawBody || !signature || !webhookSecret) {
    return false;
  }
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqualStrings(expected.toLowerCase(), signature.trim().toLowerCase());
}
