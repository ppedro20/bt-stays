import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { logError, logInfo } from "../_shared/log.ts";

type Body = {
  provider?: string;
  event_id?: string;
  provider_payment_id?: string;
  event_type?: string;
  payment_status?: string;
  payload?: unknown;
};

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
  const legacySecret = Deno.env.get("PAYMENT_WEBHOOK_SECRET");

  if (!stripeSecret && !legacySecret) {
    logError("payment_webhook", "not_configured", { requestId });
    return json({ error: "not_configured" }, 501);
  }

  const bodyText = await req.text();

  const stripeHeader = req.headers.get("stripe-signature");
  if (stripeSecret && stripeHeader) {
    const valid = await verifyStripeSignature(stripeSecret, stripeHeader, bodyText);
    if (!valid) {
      logError("payment_webhook", "stripe_signature_invalid", { requestId });
      return json({ error: "unauthorized" }, 401);
    }

    let event: {
      id: string;
      type: string;
      data: { object: { id?: string; payment_intent?: string | null } };
    };
    try {
      event = JSON.parse(bodyText);
    } catch {
      logInfo("payment_webhook", "invalid_json", { requestId, provider: "stripe" });
      return json({ error: "invalid_json" }, 400);
    }

    const eventType = event.type?.trim();
    const objectId = event.data?.object?.id?.trim();
    if (!eventType || !objectId) {
      logInfo("payment_webhook", "missing_fields", { requestId, provider: "stripe" });
      return json({ error: "missing_fields" }, 400);
    }

    let paymentStatus: string | null = null;
    if (eventType === "checkout.session.completed") {
      paymentStatus = "paid";
    } else if (eventType === "payment_intent.succeeded") {
      paymentStatus = "paid";
    } else if (eventType === "payment_intent.payment_failed") {
      paymentStatus = "failed";
    } else if (eventType === "payment_intent.canceled") {
      paymentStatus = "failed";
    } else {
      logInfo("payment_webhook", "ignored_event", { requestId, provider: "stripe", eventType });
      return json({ ok: true, ignored: true });
    }

    // For checkout.session.completed, match by session id (stored in provider_checkout_session_id).
    const providerPaymentId = eventType === "checkout.session.completed" ? objectId : objectId;

    const { error } = await supabaseAdmin.rpc("process_payment_webhook_event", {
      p_provider: "stripe",
      p_event_id: event.id,
      p_provider_payment_id: providerPaymentId,
      p_event_type: eventType,
      p_payment_status: paymentStatus,
      p_payload: event,
    });

    if (error) {
      logError("payment_webhook", "process_failed", { requestId, provider: "stripe", err: error.message });
      return json({ error: error.message }, 400);
    }
    logInfo("payment_webhook", "processed", { requestId, provider: "stripe", eventType, eventId: event.id });
    return json({ ok: true });
  }

  const provided = req.headers.get("x-webhook-secret");
  if (!provided || !legacySecret || provided !== legacySecret) {
    logError("payment_webhook", "legacy_unauthorized", { requestId });
    return json({ error: "unauthorized" }, 401);
  }

  let body: Body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    logInfo("payment_webhook", "invalid_json", { requestId, provider: "legacy" });
    return json({ error: "invalid_json" }, 400);
  }

  const provider = body.provider?.trim();
  const eventId = body.event_id?.trim();
  const providerPaymentId = body.provider_payment_id?.trim();
  const eventType = body.event_type?.trim() ?? null;
  const paymentStatus = body.payment_status?.trim() ?? "paid";

  if (!provider || !eventId) {
    logInfo("payment_webhook", "missing_fields", { requestId, provider: provider ?? "legacy" });
    return json({ error: "missing_fields" }, 400);
  }

  const { error } = await supabaseAdmin.rpc("process_payment_webhook_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_provider_payment_id: providerPaymentId ?? null,
    p_event_type: eventType,
    p_payment_status: paymentStatus,
    p_payload: body.payload ?? {},
  });

  if (error) {
    logError("payment_webhook", "process_failed", { requestId, provider, err: error.message });
    return json({ error: error.message }, 400);
  }
  logInfo("payment_webhook", "processed", { requestId, provider, eventId });
  return json({ ok: true });
});
