import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = {
  provider?: string;
  event_id?: string;
  provider_payment_id?: string;
  payload?: unknown;
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Prepared only: enable when secret is configured.
  const expected = Deno.env.get("PAYMENT_WEBHOOK_SECRET");
  if (!expected) return json({ error: "not_configured" }, 501);

  const provided = req.headers.get("x-webhook-secret");
  if (!provided || provided !== expected) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const provider = body.provider?.trim();
  const eventId = body.event_id?.trim();
  const providerPaymentId = body.provider_payment_id?.trim();

  if (!provider || !eventId) return json({ error: "missing_fields" }, 400);

  const { error } = await supabaseAdmin.rpc("process_payment_webhook_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_provider_payment_id: providerPaymentId ?? null,
    p_payload: body.payload ?? {},
  });

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});

