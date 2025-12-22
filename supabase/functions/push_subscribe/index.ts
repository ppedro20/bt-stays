import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { logError, logInfo } from "../_shared/log.ts";

type Body = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  device_id?: string | null;
  user_agent?: string | null;
};

Deno.serve(async (req) => {
  try {
    const requestId = crypto.randomUUID();
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
      logInfo("push_subscribe", "method_not_allowed", { requestId, method: req.method });
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const endpoint = body.endpoint?.trim();
    const p256dh = body.keys?.p256dh?.trim();
    const auth = body.keys?.auth?.trim();
    if (!endpoint || !p256dh || !auth) {
      return new Response(JSON.stringify({ error: "missing_subscription_fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        endpoint,
        p256dh,
        auth,
        device_id: body.device_id ?? null,
        user_agent: body.user_agent ?? null,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

    if (error) {
      logError("push_subscribe", "upsert_failed", { requestId, err: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    logError("push_subscribe", "unhandled_error", { err: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
