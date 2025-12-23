import { corsHeaders } from "../_shared/cors.ts";
import { logError, logInfo } from "../_shared/log.ts";

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const textEncoder = new TextEncoder();

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  if (typeof crypto.timingSafeEqual === "function") return crypto.timingSafeEqual(aBytes, bBytes);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseStripeSignature(header: string | null): { timestamp: string; signatures: string[] } | null {
  if (!header) return null;
  const parts = header.split(",");
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    if (k === "t") timestamp = v;
    if (k === "v1") signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

async function verifyStripeSignature(secret: string, header: string | null, bodyText: string): Promise<boolean> {
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  const signedPayload = `${parsed.timestamp}.${bodyText}`;
  const expected = await hmacHex(secret, signedPayload);
  return parsed.signatures.some((sig) => timingSafeEqualHex(sig, expected));
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    logInfo("payment_webhook", "method_not_allowed", { requestId, method: req.method });
    return json({ error: "method_not_allowed" }, 405);
  }

  const stripeSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const enqueueUrl = Deno.env.get("ENQUEUE_URL");
  const enqueueSecret = Deno.env.get("ENQUEUE_SECRET");

  if (!stripeSecret || !enqueueUrl || !enqueueSecret) {
    logError("payment_webhook", "not_configured", { requestId });
    return json({ error: "not_configured" }, 501);
  }

  const bodyText = await req.text();

  const stripeHeader = req.headers.get("stripe-signature");
  if (!stripeHeader) {
    logError("payment_webhook", "missing_signature", { requestId });
    return json({ error: "unauthorized" }, 401);
  }

  const valid = await verifyStripeSignature(stripeSecret, stripeHeader, bodyText);
  if (!valid) {
    logError("payment_webhook", "stripe_signature_invalid", { requestId });
    return json({ error: "unauthorized" }, 401);
  }

  let event: { id?: string; type?: string };
  try {
    event = JSON.parse(bodyText);
  } catch {
    logInfo("payment_webhook", "invalid_json", { requestId, provider: "stripe" });
    return json({ error: "invalid_json" }, 400);
  }

  const eventId = event.id?.trim();
  const eventType = event.type?.trim();
  if (!eventId || !eventType) {
    logInfo("payment_webhook", "missing_fields", { requestId, provider: "stripe" });
    return json({ error: "missing_fields" }, 400);
  }

  let enqueueResponse: Response;
  try {
    enqueueResponse = await fetch(enqueueUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Enqueue-Secret": enqueueSecret,
      },
      body: JSON.stringify({ event_id: eventId, event_type: eventType }),
    });
  } catch (err) {
    logError("payment_webhook", "enqueue_request_failed", { requestId, err: String(err) });
    return json({ error: "enqueue_failed" }, 502);
  }

  if (!enqueueResponse.ok) {
    const body = await enqueueResponse.text().catch(() => "");
    logError("payment_webhook", "enqueue_rejected", {
      requestId,
      status: enqueueResponse.status,
      body,
    });
    return json({ error: "enqueue_rejected" }, 502);
  }

  logInfo("payment_webhook", "enqueue_accepted", { requestId, provider: "stripe", eventId, eventType });
  return json({ ok: true });
});
