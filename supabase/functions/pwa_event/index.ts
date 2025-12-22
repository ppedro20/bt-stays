import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { logError, logInfo } from "../_shared/log.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

type Body = {
  event_type?: string;
  device_id?: string | null;
  user_agent?: string | null;
  url?: string | null;
  referrer?: string | null;
  payload?: Record<string, unknown> | null;
};

function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return "unknown";
}

Deno.serve(async (req) => {
  try {
    const requestId = crypto.randomUUID();
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
      logInfo("pwa_event", "method_not_allowed", { requestId, method: req.method });
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = getClientIp(req);
    const rl = rateLimit(`pwa_event:${ip}`, 60, 60_000);
    if (!rl.ok) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      });
    }

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventType = body.event_type?.trim();
    if (!eventType) {
      return new Response(JSON.stringify({ error: "missing_event_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabaseAdmin.from("pwa_events").insert({
      event_type: eventType,
      device_id: body.device_id ?? null,
      user_agent: body.user_agent ?? null,
      url: body.url ?? null,
      referrer: body.referrer ?? null,
      payload: body.payload ?? {},
    });

    if (error) {
      logError("pwa_event", "insert_failed", { requestId, err: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    logError("pwa_event", "unhandled_error", { err: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
